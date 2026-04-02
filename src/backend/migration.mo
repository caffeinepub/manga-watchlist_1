import Map "mo:core/Map";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";

module {
  type MangaEntry = {
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

  type UserProfile = { name : Text };
  type PasswordAttemptState = {
    attempts : Nat;
    lockoutTimestamp : Int;
    isUnlocked : Bool;
  };

  type OldActor = {
    nextEntryId : Nat;
    entries : Map.Map<Principal, Map.Map<Nat, MangaEntry>>;
    userProfiles : Map.Map<Principal, UserProfile>;
    passwordAttempts : Map.Map<Principal, PasswordAttemptState>;
  };

  type NewActor = {
    nextEntryId : Nat;
    entries : Map.Map<Principal, Map.Map<Nat, MangaEntry>>;
    userProfiles : Map.Map<Principal, UserProfile>;
    passwordAttempts : Map.Map<Principal, PasswordAttemptState>;
    deletedEntries : Map.Map<Principal, List.List<{ id : Nat; deletedAt : Int }>>;
  };

  public func run(old : OldActor) : NewActor {
    {
      nextEntryId = old.nextEntryId;
      entries = old.entries;
      userProfiles = old.userProfiles;
      passwordAttempts = old.passwordAttempts;
      deletedEntries = Map.empty<Principal, List.List<{ id : Nat; deletedAt : Int }>>();
    };
  };
};
