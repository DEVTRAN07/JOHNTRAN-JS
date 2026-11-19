/**
 * General purpose helpers: file metadata, formatting, event decoding.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzip } from "node:zlib";
import { promisify } from "node:util";
const inflateAsync = promisify(unzip);
import JSONBig from "json-bigint";
import { ZaloApiError, ZaloApiMissingImageMetadataGetter } from "./errors.js";
import { FriendEventType } from "../models/FriendEvent.js";
import { GroupEventType } from "../models/GroupEvent.js";
export const isBun = typeof Bun !== "undefined";
export function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
export function removeUndefinedKeys(obj) {
    for (const key in obj)
        if (obj[key] === undefined)
            delete obj[key];
    return obj;
}
export function decodeBase64ToBuffer(data) {
    return Buffer.from(data, "base64");
}
export function decodeUnit8Array(data) {
    try {
        return new TextDecoder().decode(data);
    }
    catch (_a) {
        return null;
    }
}
/**
 * Decodes a websocket event payload, decrypting/ decompressing it when needed.
 *
 * @param parsed Raw event `{ data, encrypt }`
 * @param cipherKey Base64 AES-GCM key (required for encrypt types 2 and 3)
 */
/**
 * Decompress Zalo WebSocket payloads in libuv's zlib worker pool.
 * Synchronous pako.inflate() blocked the event loop while processing frames.
 */
export async function inflateEventPayload(data) {
    const output = await inflateAsync(Buffer.from(data));
    return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}

export async function decodeEventData(parsed, cipherKey) {
    if (typeof parsed.data !== "string")
        throw new ZaloApiError(`Invalid data, expected string but got ${typeof parsed.data}`);
    if (typeof parsed.encrypt !== "number")
        throw new ZaloApiError(`Invalid encrypt type, expected number but got ${typeof parsed.encrypt}`);
    if (parsed.encrypt < 0 || parsed.encrypt > 3)
        throw new ZaloApiError(`Invalid encrypt type, expected 0-3 but got ${parsed.encrypt}`);
    const rawData = parsed.data;
    const encryptType = parsed.encrypt;
    if (encryptType === 0)
        return JSON.parse(rawData);
    const decodedBuffer = decodeBase64ToBuffer(encryptType === 1 ? rawData : decodeURIComponent(rawData));
    let decryptedBuffer = decodedBuffer;
    if (encryptType !== 1) {
        if (cipherKey && decodedBuffer.length >= 48) {
            const algorithm = {
                name: "AES-GCM",
                iv: decodedBuffer.subarray(0, 16),
                tagLength: 128,
                additionalData: decodedBuffer.subarray(16, 32),
            };
            const dataSource = decodedBuffer.subarray(32);
            const cryptoKey = await crypto.subtle.importKey("raw", decodeBase64ToBuffer(cipherKey), algorithm, false, [
                "decrypt",
            ]);
            decryptedBuffer = await crypto.subtle.decrypt(algorithm, cryptoKey, dataSource);
        }
        else {
            throw new ZaloApiError("Invalid data length or missing cipher key");
        }
    }
    const decompressedBuffer = encryptType === 3
        ? new Uint8Array(decryptedBuffer)
        : await inflateEventPayload(decryptedBuffer);
    const decodedData = decodeUnit8Array(decompressedBuffer);
    if (!decodedData)
        return;
    return JSONBig.parse(decodedData);
}
/**
 * MD5 of a (possibly large) file, computed by streaming the source in 2MB
 * chunks so memory usage stays constant regardless of file size.
 */
export async function getMd5LargeFileObject(source, fileSize) {
    const chunkSize = 2097152; // 2MB
    const expectedChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
    const hash = createHash("md5");
    let currentChunk = 0;
    let bytesHashed = 0;
    if (typeof source === "string") {
        const handle = await fs.promises.open(source, "r");
        try {
            const buffer = Buffer.allocUnsafe(chunkSize);
            for (;;) {
                const { bytesRead } = await handle.read(buffer, 0, chunkSize, bytesHashed);
                if (bytesRead === 0)
                    break;
                hash.update(bytesRead === chunkSize ? buffer : buffer.subarray(0, bytesRead));
                bytesHashed += bytesRead;
                currentChunk++;
            }
        }
        finally {
            await handle.close();
        }
    }
    else {
        // In-memory sources are hashed slice by slice without extra copies.
        const buffer = source.data;
        for (let offset = 0; offset < buffer.length; offset += chunkSize) {
            hash.update(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)));
            currentChunk++;
        }
        bytesHashed = buffer.length;
    }
    return {
        currentChunk: currentChunk || expectedChunks,
        data: hash.digest("hex"),
    };
}
export async function getImageMetaData(ctx, filePath) {
    if (!ctx.options.imageMetadataGetter) {
        throw new ZaloApiMissingImageMetadataGetter();
    }
    const imageData = await ctx.options.imageMetadataGetter(filePath);
    if (!imageData) {
        throw new ZaloApiError("Failed to get image metadata");
    }
    return {
        fileName: getFileName(filePath),
        totalSize: imageData.size,
        width: imageData.width,
        height: imageData.height,
    };
}
export async function getGifMetaData(ctx, filePath) {
    if (!ctx.options.imageMetadataGetter) {
        throw new ZaloApiMissingImageMetadataGetter();
    }
    const gifData = await ctx.options.imageMetadataGetter(filePath);
    if (!gifData) {
        throw new ZaloApiError("Failed to get gif metadata");
    }
    return {
        fileName: path.basename(filePath),
        totalSize: gifData.size,
        width: gifData.width,
        height: gifData.height,
    };
}
export async function getFileSize(filePath) {
    return fs.promises.stat(filePath).then((stat) => stat.size);
}
export function getFileExtension(filePath) {
    return path.extname(filePath).slice(1);
}
export function getFileName(filePath) {
    return path.basename(filePath);
}
export function strPadLeft(value, pad, length) {
    const str = String(value);
    if (str.length === length)
        return str;
    if (str.length > length)
        return str.slice(-length);
    return pad.repeat(length - str.length) + str;
}
export function formatTime(format, timestamp = Date.now()) {
    const date = new Date(timestamp);
    const options = {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    };
    if (format.includes("%H") || format.includes("%d")) {
        return format
            .replace("%H", String(date.getHours()).padStart(2, "0"))
            .replace("%M", String(date.getMinutes()).padStart(2, "0"))
            .replace("%S", String(date.getSeconds()).padStart(2, "0"))
            .replace("%d", String(date.getDate()).padStart(2, "0"))
            .replace("%m", String(date.getMonth() + 1).padStart(2, "0"))
            .replace("%Y", String(date.getFullYear()));
    }
    return new Intl.DateTimeFormat("vi-VN", options).format(date);
}
export function getFullTimeFromMillisecond(timestamp) {
    const date = new Date(timestamp);
    return (strPadLeft(date.getHours(), "0", 2) +
        ":" +
        strPadLeft(date.getMinutes(), "0", 2) +
        " " +
        strPadLeft(date.getDate(), "0", 2) +
        "/" +
        strPadLeft(date.getMonth() + 1, "0", 2) +
        "/" +
        date.getFullYear());
}
export function getClientMessageType(msgType) {
    if (msgType === "webchat")
        return 1;
    if (msgType === "chat.voice")
        return 31;
    if (msgType === "chat.photo")
        return 32;
    if (msgType === "chat.sticker")
        return 36;
    if (msgType === "chat.doodle")
        return 37;
    if (msgType === "chat.recommended")
        return 38;
    if (msgType === "chat.link")
        return 38;
    if (msgType === "chat.video.msg")
        return 44;
    if (msgType === "share.file")
        return 46;
    if (msgType === "chat.gif")
        return 49;
    if (msgType === "chat.location.new")
        return 43;
    return 1;
}
export function getGroupEventType(act) {
    if (act == "join_request")
        return GroupEventType.JOIN_REQUEST;
    if (act == "join")
        return GroupEventType.JOIN;
    if (act == "leave")
        return GroupEventType.LEAVE;
    if (act == "remove_member")
        return GroupEventType.REMOVE_MEMBER;
    if (act == "block_member")
        return GroupEventType.BLOCK_MEMBER;
    if (act == "update_setting")
        return GroupEventType.UPDATE_SETTING;
    if (act == "update_avatar")
        return GroupEventType.UPDATE_AVATAR;
    if (act == "update")
        return GroupEventType.UPDATE;
    if (act == "new_link")
        return GroupEventType.NEW_LINK;
    if (act == "add_admin")
        return GroupEventType.ADD_ADMIN;
    if (act == "remove_admin")
        return GroupEventType.REMOVE_ADMIN;
    if (act == "new_pin_topic")
        return GroupEventType.NEW_PIN_TOPIC;
    if (act == "update_pin_topic")
        return GroupEventType.UPDATE_PIN_TOPIC;
    if (act == "update_topic")
        return GroupEventType.UPDATE_TOPIC;
    if (act == "update_board")
        return GroupEventType.UPDATE_BOARD;
    if (act == "remove_board")
        return GroupEventType.REMOVE_BOARD;
    if (act == "reorder_pin_topic")
        return GroupEventType.REORDER_PIN_TOPIC;
    if (act == "unpin_topic")
        return GroupEventType.UNPIN_TOPIC;
    if (act == "remove_topic")
        return GroupEventType.REMOVE_TOPIC;
    if (act == "accept_remind")
        return GroupEventType.ACCEPT_REMIND;
    if (act == "reject_remind")
        return GroupEventType.REJECT_REMIND;
    if (act == "remind_topic")
        return GroupEventType.REMIND_TOPIC;
    return GroupEventType.UNKNOWN;
}
export function getFriendEventType(act) {
    if (act == "add")
        return FriendEventType.ADD;
    if (act == "remove")
        return FriendEventType.REMOVE;
    if (act == "block")
        return FriendEventType.BLOCK;
    if (act == "unblock")
        return FriendEventType.UNBLOCK;
    if (act == "block_call")
        return FriendEventType.BLOCK_CALL;
    if (act == "unblock_call")
        return FriendEventType.UNBLOCK_CALL;
    if (act == "req_v2")
        return FriendEventType.REQUEST;
    if (act == "reject")
        return FriendEventType.REJECT_REQUEST;
    if (act == "undo_req")
        return FriendEventType.UNDO_REQUEST;
    if (act == "seen_fr_req")
        return FriendEventType.SEEN_FRIEND_REQUEST;
    if (act == "pin_unpin")
        return FriendEventType.PIN_UNPIN;
    if (act == "pin_create")
        return FriendEventType.PIN_CREATE;
    return FriendEventType.UNKNOWN;
}
/**
 * Converts a hex color code (`#RRGGBB` / `#AARRGGBB`) into the negative color
 * number used by the Zalo API.
 */
export function hexToNegativeColor(hex) {
    if (!hex.startsWith("#"))
        hex = "#" + hex;
    let hexValue = hex.slice(1);
    if (hexValue.length === 6)
        hexValue = "FF" + hexValue;
    const decimal = parseInt(hexValue, 16);
    return decimal > 0x7fffffff ? decimal - 4294967296 : decimal;
}
/**
 * Converts a negative color number from the Zalo API back into a hex color.
 */
export function negativeColorToHex(negativeColor) {
    const positiveColor = negativeColor + 4294967296;
    return "#" + positiveColor.toString(16).slice(-6).padStart(6, "0");
}
/**
 * Normalizes a bank account holder name (uppercase, accent-free, A-Z0-9 only).
 */
export function normalizeHolderName(input) {
    if (!input)
        return undefined;
    const normalized = input
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .trim();
    return normalized.length >= 5 ? normalized : undefined;
}
