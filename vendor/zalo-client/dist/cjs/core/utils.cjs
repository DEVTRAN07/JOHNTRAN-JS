'use strict';

var node_crypto = require('node:crypto');
var fs = require('node:fs');
var path = require('node:path');
var node_zlib = require('node:zlib');
var node_util = require('node:util');
var inflateAsync = node_util.promisify(node_zlib.unzip);
var JSONBig = require('json-bigint');
var errors = require('./errors.cjs');
var FriendEvent = require('../models/FriendEvent.cjs');
var GroupEvent = require('../models/GroupEvent.cjs');

/**
 * General purpose helpers: file metadata, formatting, event decoding.
 */
function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}
function removeUndefinedKeys(obj) {
    for (const key in obj)
        if (obj[key] === undefined)
            delete obj[key];
    return obj;
}
function decodeBase64ToBuffer(data) {
    return Buffer.from(data, "base64");
}
function decodeUnit8Array(data) {
    try {
        return new TextDecoder().decode(data);
    }
    catch (_a) {
        return null;
    }
}
async function inflateEventPayload(data) {
    const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return await inflateAsync(input);
}
/**
 * Decodes a websocket event payload, decrypting/ decompressing it when needed.
 *
 * @param parsed Raw event `{ data, encrypt }`
 * @param cipherKey Base64 AES-GCM key (required for encrypt types 2 and 3)
 */
async function decodeEventData(parsed, cipherKey) {
    if (typeof parsed.data !== "string")
        throw new errors.ZaloApiError(`Invalid data, expected string but got ${typeof parsed.data}`);
    if (typeof parsed.encrypt !== "number")
        throw new errors.ZaloApiError(`Invalid encrypt type, expected number but got ${typeof parsed.encrypt}`);
    if (parsed.encrypt < 0 || parsed.encrypt > 3)
        throw new errors.ZaloApiError(`Invalid encrypt type, expected 0-3 but got ${parsed.encrypt}`);
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
            throw new errors.ZaloApiError("Invalid data length or missing cipher key");
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
async function getMd5LargeFileObject(source, fileSize) {
    const chunkSize = 2097152; // 2MB
    const expectedChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
    const hash = node_crypto.createHash("md5");
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
async function getImageMetaData(ctx, filePath) {
    if (!ctx.options.imageMetadataGetter) {
        throw new errors.ZaloApiMissingImageMetadataGetter();
    }
    const imageData = await ctx.options.imageMetadataGetter(filePath);
    if (!imageData) {
        throw new errors.ZaloApiError("Failed to get image metadata");
    }
    return {
        fileName: getFileName(filePath),
        totalSize: imageData.size,
        width: imageData.width,
        height: imageData.height,
    };
}
async function getGifMetaData(ctx, filePath) {
    if (!ctx.options.imageMetadataGetter) {
        throw new errors.ZaloApiMissingImageMetadataGetter();
    }
    const gifData = await ctx.options.imageMetadataGetter(filePath);
    if (!gifData) {
        throw new errors.ZaloApiError("Failed to get gif metadata");
    }
    return {
        fileName: path.basename(filePath),
        totalSize: gifData.size,
        width: gifData.width,
        height: gifData.height,
    };
}
async function getFileSize(filePath) {
    return fs.promises.stat(filePath).then((stat) => stat.size);
}
function getFileExtension(filePath) {
    return path.extname(filePath).slice(1);
}
function getFileName(filePath) {
    return path.basename(filePath);
}
function strPadLeft(value, pad, length) {
    const str = String(value);
    if (str.length === length)
        return str;
    if (str.length > length)
        return str.slice(-length);
    return pad.repeat(length - str.length) + str;
}
function formatTime(format, timestamp = Date.now()) {
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
function getFullTimeFromMillisecond(timestamp) {
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
function getClientMessageType(msgType) {
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
function getGroupEventType(act) {
    if (act == "join_request")
        return GroupEvent.GroupEventType.JOIN_REQUEST;
    if (act == "join")
        return GroupEvent.GroupEventType.JOIN;
    if (act == "leave")
        return GroupEvent.GroupEventType.LEAVE;
    if (act == "remove_member")
        return GroupEvent.GroupEventType.REMOVE_MEMBER;
    if (act == "block_member")
        return GroupEvent.GroupEventType.BLOCK_MEMBER;
    if (act == "update_setting")
        return GroupEvent.GroupEventType.UPDATE_SETTING;
    if (act == "update_avatar")
        return GroupEvent.GroupEventType.UPDATE_AVATAR;
    if (act == "update")
        return GroupEvent.GroupEventType.UPDATE;
    if (act == "new_link")
        return GroupEvent.GroupEventType.NEW_LINK;
    if (act == "add_admin")
        return GroupEvent.GroupEventType.ADD_ADMIN;
    if (act == "remove_admin")
        return GroupEvent.GroupEventType.REMOVE_ADMIN;
    if (act == "new_pin_topic")
        return GroupEvent.GroupEventType.NEW_PIN_TOPIC;
    if (act == "update_pin_topic")
        return GroupEvent.GroupEventType.UPDATE_PIN_TOPIC;
    if (act == "update_topic")
        return GroupEvent.GroupEventType.UPDATE_TOPIC;
    if (act == "update_board")
        return GroupEvent.GroupEventType.UPDATE_BOARD;
    if (act == "remove_board")
        return GroupEvent.GroupEventType.REMOVE_BOARD;
    if (act == "reorder_pin_topic")
        return GroupEvent.GroupEventType.REORDER_PIN_TOPIC;
    if (act == "unpin_topic")
        return GroupEvent.GroupEventType.UNPIN_TOPIC;
    if (act == "remove_topic")
        return GroupEvent.GroupEventType.REMOVE_TOPIC;
    if (act == "accept_remind")
        return GroupEvent.GroupEventType.ACCEPT_REMIND;
    if (act == "reject_remind")
        return GroupEvent.GroupEventType.REJECT_REMIND;
    if (act == "remind_topic")
        return GroupEvent.GroupEventType.REMIND_TOPIC;
    return GroupEvent.GroupEventType.UNKNOWN;
}
function getFriendEventType(act) {
    if (act == "add")
        return FriendEvent.FriendEventType.ADD;
    if (act == "remove")
        return FriendEvent.FriendEventType.REMOVE;
    if (act == "block")
        return FriendEvent.FriendEventType.BLOCK;
    if (act == "unblock")
        return FriendEvent.FriendEventType.UNBLOCK;
    if (act == "block_call")
        return FriendEvent.FriendEventType.BLOCK_CALL;
    if (act == "unblock_call")
        return FriendEvent.FriendEventType.UNBLOCK_CALL;
    if (act == "req_v2")
        return FriendEvent.FriendEventType.REQUEST;
    if (act == "reject")
        return FriendEvent.FriendEventType.REJECT_REQUEST;
    if (act == "undo_req")
        return FriendEvent.FriendEventType.UNDO_REQUEST;
    if (act == "seen_fr_req")
        return FriendEvent.FriendEventType.SEEN_FRIEND_REQUEST;
    if (act == "pin_unpin")
        return FriendEvent.FriendEventType.PIN_UNPIN;
    if (act == "pin_create")
        return FriendEvent.FriendEventType.PIN_CREATE;
    return FriendEvent.FriendEventType.UNKNOWN;
}
/**
 * Normalizes a bank account holder name (uppercase, accent-free, A-Z0-9 only).
 */
function normalizeHolderName(input) {
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

exports.decodeBase64ToBuffer = decodeBase64ToBuffer;
exports.decodeEventData = decodeEventData;
exports.inflateEventPayload = inflateEventPayload;
exports.decodeUnit8Array = decodeUnit8Array;
exports.formatTime = formatTime;
exports.getClientMessageType = getClientMessageType;
exports.getFileExtension = getFileExtension;
exports.getFileName = getFileName;
exports.getFileSize = getFileSize;
exports.getFriendEventType = getFriendEventType;
exports.getFullTimeFromMillisecond = getFullTimeFromMillisecond;
exports.getGifMetaData = getGifMetaData;
exports.getGroupEventType = getGroupEventType;
exports.getImageMetaData = getImageMetaData;
exports.getMd5LargeFileObject = getMd5LargeFileObject;
exports.hasOwn = hasOwn;
exports.normalizeHolderName = normalizeHolderName;
exports.removeUndefinedKeys = removeUndefinedKeys;
exports.strPadLeft = strPadLeft;
