import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface MangaEntry {
    id: bigint;
    status: Variant_Complete_Incomplete;
    coverImageKey?: string;
    chaptersOwned: number;
    mainTitle: string;
    artRating: number;
    altTitle: string;
    chaptersRead: number;
    createdAt: bigint;
    updatedAt: bigint;
    cenLevel: number;
    synopsis: string;
    genres: Array<string>;
    notes: string;
    rating: number;
}
export interface MangaEntryInput {
    status: Variant_Complete_Incomplete;
    coverImageKey?: string;
    chaptersOwned: number;
    mainTitle: string;
    artRating: number;
    altTitle: string;
    chaptersRead: number;
    cenLevel: number;
    synopsis: string;
    genres: Array<string>;
    notes: string;
    rating: number;
}
export interface UserProfile {
    name: string;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export enum Variant_Complete_Incomplete {
    Complete = "Complete",
    Incomplete = "Incomplete"
}
export interface backendInterface {
    addEntry(input: MangaEntryInput): Promise<bigint>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    deleteEntry(id: bigint): Promise<boolean>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getEntries(): Promise<Array<MangaEntry>>;
    getEntry(id: bigint): Promise<MangaEntry | null>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    isCallerAdmin(): Promise<boolean>;
    isUnlocked(): Promise<boolean>;
    resetAttempts(user: Principal): Promise<void>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    updateEntry(id: bigint, input: MangaEntryInput): Promise<boolean>;
    verifyPassword(input: string): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "fail";
        fail: bigint;
    } | {
        __kind__: "locked";
        locked: bigint;
    }>;
}
