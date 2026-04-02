import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { MangaEntry, MangaEntryInput } from "../backend";
import { syncEntries } from "../utils/syncManager";
import { useActor } from "./useActor";
import { useInternetIdentity } from "./useInternetIdentity";

export function useIsUnlocked() {
  const { actor, isFetching: actorFetching } = useActor();
  const { identity } = useInternetIdentity();
  const isEnabled = !!actor && !actorFetching && !!identity;

  const query = useQuery<boolean>({
    queryKey: ["isUnlocked", identity?.getPrincipal().toString()],
    queryFn: async () => {
      if (!actor) return false;
      return actor.isUnlocked();
    },
    enabled: isEnabled,
    staleTime: 60_000,
  });

  return {
    ...query,
    isLoadingUnlock:
      actorFetching || (!query.isFetched && !query.isError && !!identity),
  };
}

export function useGetEntries() {
  const { actor, isFetching: actorFetching } = useActor();
  const { identity } = useInternetIdentity();

  return useQuery<MangaEntry[]>({
    queryKey: ["entries", identity?.getPrincipal().toString()],
    queryFn: async () => {
      if (!actor || !identity) return [];
      return syncEntries(actor, identity.getPrincipal().toString());
    },
    enabled: !!actor && !actorFetching && !!identity,
  });
}

export function useAddEntry() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  const { identity } = useInternetIdentity();

  return useMutation({
    mutationFn: async (input: MangaEntryInput) => {
      if (!actor) throw new Error("Not authenticated");
      return actor.addEntry(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["entries", identity?.getPrincipal().toString()],
      });
    },
  });
}

export function useUpdateEntry() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  const { identity } = useInternetIdentity();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: { id: bigint; input: MangaEntryInput }) => {
      if (!actor) throw new Error("Not authenticated");
      return actor.updateEntry(id, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["entries", identity?.getPrincipal().toString()],
      });
    },
  });
}

export function useDeleteEntry() {
  const { actor } = useActor();
  const actorRef = useRef(actor);
  actorRef.current = actor;
  const queryClient = useQueryClient();
  const { identity } = useInternetIdentity();

  return useMutation({
    mutationFn: async (id: bigint) => {
      const currentActor = actorRef.current;
      if (!currentActor) throw new Error("Not authenticated");
      const delays = [500, 1000, 2000];
      let lastError: unknown;
      for (let attempt = 0; attempt <= 3; attempt++) {
        try {
          return await currentActor.deleteEntry(id);
        } catch (e) {
          lastError = e;
          if (attempt < 3) {
            await new Promise((res) => setTimeout(res, delays[attempt]));
          }
        }
      }
      throw lastError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["entries", identity?.getPrincipal().toString()],
      });
    },
  });
}

export function useVerifyPassword() {
  const { actor } = useActor();
  const queryClient = useQueryClient();
  const { identity } = useInternetIdentity();

  return useMutation({
    mutationFn: async (password: string) => {
      if (!actor) throw new Error("Not authenticated");
      return actor.verifyPassword(password);
    },
    onSuccess: (result) => {
      if (result.__kind__ === "ok") {
        queryClient.invalidateQueries({
          queryKey: ["isUnlocked", identity?.getPrincipal().toString()],
        });
      }
    },
  });
}
