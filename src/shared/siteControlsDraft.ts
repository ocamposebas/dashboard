export interface SiteControlsDraftState {
  dirty: boolean;
  hydratedRevision: number | null;
  publishedRevision: number | null;
  remoteChanged: boolean;
}

export interface SiteControlsDraftDecision {
  hydrate: boolean;
  state: SiteControlsDraftState;
}

export const initialSiteControlsDraftState = (): SiteControlsDraftState => ({
  dirty: false,
  hydratedRevision: null,
  publishedRevision: null,
  remoteChanged: false,
});

export function markSiteControlsDraftDirty(state: SiteControlsDraftState): SiteControlsDraftState {
  return { ...state, dirty: true };
}

export function reconcileSiteControlsDraft(
  state: SiteControlsDraftState,
  publishedRevision: number,
  force = false,
): SiteControlsDraftDecision {
  const normalizedRevision = Number.isSafeInteger(publishedRevision) && publishedRevision >= 0
    ? publishedRevision
    : 0;
  const hydrate = force || state.hydratedRevision === null || !state.dirty;

  if (hydrate) {
    return {
      hydrate: true,
      state: {
        dirty: false,
        hydratedRevision: normalizedRevision,
        publishedRevision: normalizedRevision,
        remoteChanged: false,
      },
    };
  }

  return {
    hydrate: false,
    state: {
      ...state,
      publishedRevision: normalizedRevision,
      remoteChanged: normalizedRevision !== state.hydratedRevision,
    },
  };
}
