"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BUILDING_CONTEXT_PARAM = "building";
const BUILDING_CONTEXT_STORAGE_PREFIX = "bunnywell.portal.buildingContext";
const LEGACY_BUILDING_PARAMS = ["salesBuildingId", "rentalsBuildingId", "allocationBuildingId"] as const;

type BuildingContextOption = {
  id: string;
};

export function resolveBuildingContext(input: {
  accessibleBuildingIds: string[];
  canonicalValue?: string | null;
  legacyValues?: Array<string | null | undefined>;
  savedValue?: string | null;
}) {
  const allowedIds = new Set(input.accessibleBuildingIds);

  if (input.accessibleBuildingIds.length === 1) return input.accessibleBuildingIds[0];

  const requestedValue = [
    input.canonicalValue,
    ...(input.legacyValues ?? []),
    input.savedValue,
  ].find((value) => typeof value === "string" && value.length > 0);

  if (!requestedValue || requestedValue === "all") return "";
  return allowedIds.has(requestedValue) ? requestedValue : "";
}

function storageKey(userId: string) {
  return `${BUILDING_CONTEXT_STORAGE_PREFIX}.${userId}`;
}

function replaceBuildingContextInUrl(buildingId: string) {
  const params = new URLSearchParams(window.location.search);
  params.set(BUILDING_CONTEXT_PARAM, buildingId || "all");
  LEGACY_BUILDING_PARAMS.forEach((param) => params.delete(param));
  const search = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
}

export function usePortalBuildingContext({
  userId,
  buildings,
  ready,
}: {
  userId?: string | null;
  buildings: BuildingContextOption[];
  ready: boolean;
}) {
  const [buildingContextId, setBuildingContextState] = useState("");
  const initializedUserId = useRef<string | null>(null);
  const accessibleBuildingIds = useMemo(() => buildings.map((building) => building.id), [buildings]);
  const persistContext = useCallback((nextBuildingId: string) => {
    if (!userId || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(userId), nextBuildingId || "all");
    replaceBuildingContextInUrl(nextBuildingId);
  }, [userId]);

  const setBuildingContextId = useCallback((requestedBuildingId: string) => {
    const nextBuildingId = resolveBuildingContext({
      accessibleBuildingIds,
      canonicalValue: requestedBuildingId || "all",
    });
    setBuildingContextState(nextBuildingId);
    persistContext(nextBuildingId);
  }, [accessibleBuildingIds, persistContext]);

  useEffect(() => {
    if (!ready || !userId || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const savedValue = window.localStorage.getItem(storageKey(userId));
    const nextBuildingId = resolveBuildingContext({
      accessibleBuildingIds,
      canonicalValue: params.get(BUILDING_CONTEXT_PARAM),
      legacyValues: LEGACY_BUILDING_PARAMS.map((param) => params.get(param)),
      savedValue,
    });

    if (initializedUserId.current !== userId) {
      initializedUserId.current = userId;
      setBuildingContextState(nextBuildingId);
      persistContext(nextBuildingId);
      return;
    }

    setBuildingContextState((currentBuildingId) => {
      const validBuildingId = resolveBuildingContext({
        accessibleBuildingIds,
        canonicalValue: currentBuildingId || "all",
      });
      if (validBuildingId !== currentBuildingId) persistContext(validBuildingId);
      return validBuildingId;
    });
  }, [accessibleBuildingIds, persistContext, ready, userId]);

  useEffect(() => {
    if (!ready || !userId || typeof window === "undefined") return;

    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const nextBuildingId = resolveBuildingContext({
        accessibleBuildingIds,
        canonicalValue: params.get(BUILDING_CONTEXT_PARAM),
        legacyValues: LEGACY_BUILDING_PARAMS.map((param) => params.get(param)),
        savedValue: window.localStorage.getItem(storageKey(userId!)),
      });
      setBuildingContextState(nextBuildingId);
      window.localStorage.setItem(storageKey(userId!), nextBuildingId || "all");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [accessibleBuildingIds, ready, userId]);

  return { buildingContextId, setBuildingContextId };
}
