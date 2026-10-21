import assert from "node:assert/strict";
import test from "node:test";
import {
  initialSiteControlsDraftState,
  markSiteControlsDraftDirty,
  reconcileSiteControlsDraft,
} from "../src/shared/siteControlsDraft";

test("site controls hydrate from the server on first load", () => {
  const decision = reconcileSiteControlsDraft(initialSiteControlsDraftState(), 4);

  assert.equal(decision.hydrate, true);
  assert.deepEqual(decision.state, {
    dirty: false,
    hydratedRevision: 4,
    publishedRevision: 4,
    remoteChanged: false,
  });
});

test("automatic refresh never replaces an unsaved site controls draft", () => {
  const hydrated = reconcileSiteControlsDraft(initialSiteControlsDraftState(), 4).state;
  const dirty = markSiteControlsDraftDirty(hydrated);
  const decision = reconcileSiteControlsDraft(dirty, 4);

  assert.equal(decision.hydrate, false);
  assert.equal(decision.state.dirty, true);
  assert.equal(decision.state.remoteChanged, false);
});

test("a newer server revision is reported without replacing the draft", () => {
  const hydrated = reconcileSiteControlsDraft(initialSiteControlsDraftState(), 4).state;
  const dirty = markSiteControlsDraftDirty(hydrated);
  const decision = reconcileSiteControlsDraft(dirty, 5);

  assert.equal(decision.hydrate, false);
  assert.equal(decision.state.hydratedRevision, 4);
  assert.equal(decision.state.publishedRevision, 5);
  assert.equal(decision.state.remoteChanged, true);
});

test("an explicit reload may discard the draft and hydrate the latest revision", () => {
  const hydrated = reconcileSiteControlsDraft(initialSiteControlsDraftState(), 4).state;
  const dirty = markSiteControlsDraftDirty(hydrated);
  const decision = reconcileSiteControlsDraft(dirty, 5, true);

  assert.equal(decision.hydrate, true);
  assert.deepEqual(decision.state, {
    dirty: false,
    hydratedRevision: 5,
    publishedRevision: 5,
    remoteChanged: false,
  });
});
