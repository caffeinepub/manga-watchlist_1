import Time "mo:core/Time";
import Float "mo:core/Float";
import Bool "mo:core/Bool";
import Array "mo:core/Array";
import List "mo:core/List";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Iter "mo:core/Iter";
import Map "mo:core/Map";
import Order "mo:core/Order";
import Principal "mo:core/Principal";

import MixinAuthorization "authorization/MixinAuthorization";
import AccessControl "authorization/access-control";
import Runtime "mo:core/Runtime";

import MixinStorage "blob-storage/Mixin";

actor {
  // Mixins
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);
  include MixinStorage();

  // Type Definitions
  public type MangaEntry = {
    id : Nat;
    mainTitle : Text;
    altTitle : Text;
    synopsis : Text;
    coverImageKey : ?Text;
    genres : [Text];
    status : {
      #Incomplete;
      #Complete;
    };
    rating : Float;
    artRating : Float;
    cenLevel : Float;
    chaptersOwned : Float;
    chaptersRead : Float;
    notes : Text;
    createdAt : Int;
    updatedAt : Int;
  };

  public type MangaEntryInput = {
    mainTitle : Text;
    altTitle : Text;
    synopsis : Text;
    coverImageKey : ?Text;
    genres : [Text];
    status : {
      #Incomplete;
      #Complete;
    };
    rating : Float;
    artRating : Float;
    cenLevel : Float;
    chaptersOwned : Float;
    chaptersRead : Float;
    notes : Text;
  };

  public type UserProfile = {
    name : Text;
  };

  type PasswordAttemptState = {
    attempts : Nat;
    lockoutTimestamp : Int;
    isUnlocked : Bool;
  };

  module MangaEntry {
    public func compare(entry1 : MangaEntry, entry2 : MangaEntry) : Order.Order {
      Nat.compare(entry1.id, entry2.id);
    };
  };

  // State
  var nextEntryId = 0;
  let entries = Map.empty<Principal, Map.Map<Nat, MangaEntry>>();
  let passwordAttempts = Map.empty<Principal, PasswordAttemptState>();
  let userProfiles = Map.empty<Principal, UserProfile>();

  // Constants
  let password = "kamehamea";
  let maxAttempts = 3;
  let lockoutDuration = 300_000_000_000; // 5 minutes in nanoseconds

  // Helper Functions
  func roundToHalf(value : Float) : Float {
    (value * 2).toInt().toFloat() / 2;
  };

  func roundToTenths(value : Float) : Float {
    (value * 10).toInt().toFloat() / 10;
  };

  func getEntriesMap(user : Principal) : Map.Map<Nat, MangaEntry> {
    switch (entries.get(user)) {
      case (null) { Map.empty<Nat, MangaEntry>() };
      case (?userEntries) { userEntries };
    };
  };

  // User Profile Functions
  public query ({ caller }) func getCallerUserProfile() : async ?UserProfile {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can access profiles");
    };
    userProfiles.get(caller);
  };

  public query ({ caller }) func getUserProfile(user : Principal) : async ?UserProfile {
    if (caller != user and not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Can only view your own profile");
    };
    userProfiles.get(user);
  };

  public shared ({ caller }) func saveCallerUserProfile(profile : UserProfile) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save profiles");
    };
    userProfiles.add(caller, profile);
  };

  // Password Gate
  public shared ({ caller }) func verifyPassword(input : Text) : async {
    #ok;
    #fail : Nat;
    #locked : Int;
  } {
    let now = Time.now();
    let state = switch (passwordAttempts.get(caller)) {
      case (null) {
        let newState = {
          attempts = 0;
          lockoutTimestamp = 0;
          isUnlocked = false;
        };
        passwordAttempts.add(caller, newState);
        newState;
      };
      case (?state) { state };
    };

    if (state.isUnlocked) {
      return #ok;
    };

    if (now < state.lockoutTimestamp) {
      return #locked((state.lockoutTimestamp - now) / 1_000_000_000);
    };

    if (input == password) {
      let newState = { state with isUnlocked = true; attempts = 0; lockoutTimestamp = 0 };
      passwordAttempts.add(caller, newState);
      return #ok;
    };

    let newAttempts = state.attempts + 1;
    if (newAttempts >= maxAttempts) {
      let newState = {
        state with
        attempts = newAttempts;
        lockoutTimestamp = now + lockoutDuration;
      };
      passwordAttempts.add(caller, newState);
      return #locked(lockoutDuration / 1_000_000_000);
    };

    let newState = { state with attempts = newAttempts };
    passwordAttempts.add(caller, newState);
    #fail(maxAttempts - newAttempts);
  };

  public query ({ caller }) func isUnlocked() : async Bool {
    switch (passwordAttempts.get(caller)) {
      case (null) { false };
      case (?state) { state.isUnlocked };
    };
  };

  public shared ({ caller }) func resetAttempts(user : Principal) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #admin))) {
      Runtime.trap("Unauthorized: Only admins can reset attempts");
    };

    passwordAttempts.add(
      user,
      {
        attempts = 0;
        lockoutTimestamp = 0;
        isUnlocked = false;
      },
    );
  };

  // Manga Entry Management
  public shared ({ caller }) func addEntry(input : MangaEntryInput) : async Nat {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can add entries");
    };

    let entry : MangaEntry = {
      id = nextEntryId;
      mainTitle = input.mainTitle;
      altTitle = input.altTitle;
      synopsis = input.synopsis;
      coverImageKey = input.coverImageKey;
      genres = input.genres;
      status = input.status;
      rating = roundToHalf(input.rating);
      artRating = roundToTenths(input.artRating);
      cenLevel = roundToTenths(input.cenLevel);
      chaptersOwned = input.chaptersOwned;
      chaptersRead = input.chaptersRead;
      notes = input.notes;
      createdAt = Time.now();
      updatedAt = Time.now();
    };

    let userEntries = getEntriesMap(caller);
    userEntries.add(nextEntryId, entry);
    entries.add(caller, userEntries);
    nextEntryId += 1;
    entry.id;
  };

  public shared ({ caller }) func updateEntry(id : Nat, input : MangaEntryInput) : async Bool {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can update entries");
    };

    let userEntries = getEntriesMap(caller);
    switch (userEntries.get(id)) {
      case (null) { false };
      case (?existingEntry) {
        let updatedEntry = {
          id = existingEntry.id;
          mainTitle = input.mainTitle;
          altTitle = input.altTitle;
          synopsis = input.synopsis;
          coverImageKey = input.coverImageKey;
          genres = input.genres;
          status = input.status;
          rating = roundToHalf(input.rating);
          artRating = roundToTenths(input.artRating);
          cenLevel = roundToTenths(input.cenLevel);
          chaptersOwned = input.chaptersOwned;
          chaptersRead = input.chaptersRead;
          notes = input.notes;
          createdAt = existingEntry.createdAt;
          updatedAt = Time.now();
        };
        userEntries.add(id, updatedEntry);
        entries.add(caller, userEntries);
        true;
      };
    };
  };

  public shared ({ caller }) func deleteEntry(id : Nat) : async Bool {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can delete entries");
    };

    let userEntries = getEntriesMap(caller);
    let existed = userEntries.containsKey(id);
    userEntries.remove(id);
    entries.add(caller, userEntries);
    existed;
  };

  public query ({ caller }) func getEntries() : async [MangaEntry] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view entries");
    };

    getEntriesMap(caller).values().toArray().sort();
  };

  public query ({ caller }) func getEntry(id : Nat) : async ?MangaEntry {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view entries");
    };

    getEntriesMap(caller).get(id);
  };
};
