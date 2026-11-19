/**
 * General purpose helpers: file metadata, formatting, event decoding.
 */
import type { ContextBase } from "./context.js";
import { FriendEventType } from "../models/FriendEvent.js";
import { GroupEventType } from "../models/GroupEvent.js";
import type { AttachmentSource } from "../models/Attachment.js";
export declare const isBun: boolean;
export declare function hasOwn(obj: Record<string, unknown>, key: string): key is keyof typeof obj;
export declare function removeUndefinedKeys<T extends Record<string, unknown>>(obj: T): T;
export declare function decodeBase64ToBuffer(data: string): Buffer;
export declare function decodeUnit8Array(data: Uint8Array): string | null;
/**
 * Decodes a websocket event payload, decrypting/ decompressing it when needed.
 *
 * @param parsed Raw event `{ data, encrypt }`
 * @param cipherKey Base64 AES-GCM key (required for encrypt types 2 and 3)
 */
export declare function inflateEventPayload(data: Uint8Array): Promise<Uint8Array>;
export declare function decodeEventData(parsed: Record<string, unknown>, cipherKey?: string): Promise<any>;
/**
 * MD5 of a (possibly large) file, computed by streaming the source in 2MB
 * chunks so memory usage stays constant regardless of file size.
 */
export declare function getMd5LargeFileObject(source: AttachmentSource, fileSize: number): Promise<{
    currentChunk: number;
    data: string;
}>;
export declare function getImageMetaData(ctx: ContextBase, filePath: string): Promise<{
    fileName: string;
    totalSize: number;
    width: number;
    height: number;
}>;
export declare function getGifMetaData(ctx: ContextBase, filePath: string): Promise<{
    fileName: string;
    totalSize: number;
    width: number;
    height: number;
}>;
export declare function getFileSize(filePath: string): Promise<number>;
export declare function getFileExtension(filePath: string): string;
export declare function getFileName(filePath: string): string;
export declare function strPadLeft(value: number | string, pad: string, length: number): string;
export declare function formatTime(format: string, timestamp?: number): string;
export declare function getFullTimeFromMillisecond(timestamp: number): string;
export declare function getClientMessageType(msgType: string): number;
export declare function getGroupEventType(act: string): GroupEventType;
export declare function getFriendEventType(act: string): FriendEventType;
/**
 * Converts a hex color code (`#RRGGBB` / `#AARRGGBB`) into the negative color
 * number used by the Zalo API.
 */
export declare function hexToNegativeColor(hex: string): number;
/**
 * Converts a negative color number from the Zalo API back into a hex color.
 */
export declare function negativeColorToHex(negativeColor: number): string;
/**
 * Normalizes a bank account holder name (uppercase, accent-free, A-Z0-9 only).
 */
export declare function normalizeHolderName(input?: string): string | undefined;
