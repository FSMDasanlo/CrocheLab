const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createService() {
  const documents = new Map();
  const uploads = [];
  let failWrite = false;
  let failUpload = false;
  let failDownloadUrl = false;
  let user = { uid: "user-1" };
  let observer;
  function ref(key) {
    return {
      collection(name) { return collection(key + "/" + name); },
      get() { return Promise.resolve(snapshot(key)); }
    };
  }
  function collection(key) {
    return {
      doc(id) { return ref(key + "/" + id); },
      get() {
        return Promise.resolve({
          forEach(fn) {
            for (const [name, data] of documents) {
              if (name.startsWith(key + "/") && !name.slice(key.length + 1).includes("/")) {
                fn({ data: () => structuredClone(data) });
              }
            }
          }
        });
      }
    };
  }
  function snapshot(key) {
    const data = documents.get(key);
    return { exists: data !== undefined, data: () => structuredClone(data) };
  }
  const db = {
    collection,
    async runTransaction(callback) {
      const actions = [];
      const tx = {
        get: target => target.get(),
        set(target, data) { actions.push(() => documents.set(target.key, structuredClone(data))); },
        delete(target) { actions.push(() => documents.delete(target.key)); }
      };
      const result = await callback(tx);
      if (failWrite) throw new Error("write failed");
      actions.forEach(action => action());
      return result;
    }
  };
  // Keep the mock references identifiable by the transaction.
  const originalRef = ref;
  ref = function (key) { return Object.assign(originalRef(key), { key }); };
  const storage = {
    ref(key) {
      return {
        async getDownloadURL() {
          if (failDownloadUrl) throw new Error("URL failed");
          return "https://example.invalid/" + key;
        },
        async put(blob) {
          uploads.push(key);
          if (typeof failUpload === "function" ? failUpload(key) : failUpload) throw new Error("upload failed");
          return { ref: this };
        }
      };
    }
  };
  const firebase = {
    apps: [],
    initializeApp() {},
    auth() { return { onAuthStateChanged(fn) { observer = fn; fn(user); } }; },
    firestore() { return db; },
    storage() { return storage; }
  };
  const window = { CROCHELAB_FIREBASE_CONFIG: { apiKey: "fixture", projectId: "fixture" } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "firebase-service.js"), "utf8"), {
    window, firebase, Blob, Uint8Array, ArrayBuffer, Date, Object, Promise,
    crypto: { randomUUID: () => "upload-" + (uploads.length + 1) },
    console, encodeURIComponent
  });
  window.CrocheLabFirebase.init();
  return {
    service: window.CrocheLabFirebase, documents, uploads,
    setWriteFailure(value) { failWrite = value; },
    setUploadFailure(value) { failUpload = value; },
    setDownloadFailure(value) { failDownloadUrl = value; },
    setUser(value) { user = value; observer(user); }
  };
}

function project() {
  return { id: "p1", name: "Original", garment: "Chal", description: "", createdAt: "a", updatedAt: "b", photos: [], extra: { note: "conservar" } };
}

function localHarness(sameData) {
  const stores = { projects: new Map(), patterns: new Map() };
  let current = true;
  const database = {
    transaction(names) {
      const copies = {};
      names.forEach(name => { copies[name] = new Map(stores[name]); });
      let pending = 0;
      let aborted = false;
      let completed = false;
      const tx = {
        error: null,
        abort() { aborted = true; setImmediate(() => tx.onabort()); },
        objectStore(name) {
          return {
            get(key) {
              const request = {};
              pending++;
              setImmediate(() => {
                if (aborted) return;
                const value = copies[name].get(key);
                request.result = value === undefined ? undefined : structuredClone(value);
                request.onsuccess();
                pending--;
                if (!pending) setImmediate(() => {
                  if (pending || aborted || completed) return;
                  completed = true;
                  names.forEach(store => { stores[store] = copies[store]; });
                  tx.oncomplete();
                });
              });
              return request;
            },
            put(value) { copies[name].set(value.id, structuredClone(value)); },
            delete(key) { copies[name].delete(key); }
          };
        }
      };
      return tx;
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const start = source.indexOf("  function localTransaction(");
  const end = source.indexOf("  function openDatabase()", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    database, firebaseService: { sameData }, isCurrentContext: () => current,
    Promise, Set, Array, Error
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.runLocal = localTransaction;", context);
  return { stores, run: context.runLocal, setCurrent(value) { current = value; } };
}

async function submitAndObserve(saveFailure) {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const start = source.indexOf("  function onFormSubmit(");
  const end = source.indexOf("  function onProjectListClick(", start);
  assert.ok(start >= 0 && end > start);
  const messages = [];
  let closed = false;
  const context = {
    projectBusy: false, editingContext: {}, editingSnapshot: null, pendingProjectId: "p1",
    editingProjectId: null, projects: [], stagedPhotos: [{ id: "photo1", label: "foto", name: "foto", blob: new Blob(["x"]) }],
    elements: {
      projectForm: { reportValidity: () => true, querySelectorAll: () => [] },
      name: { value: "Prueba" }, garment: { value: "Chal" }, description: { value: "" }
    },
    isCurrentContext: () => true,
    saveProject: () => saveFailure ? Promise.reject(new Error("save failed")) : Promise.resolve(),
    closeProjectDialog: () => { closed = true; },
    refreshProjects: () => Promise.reject(new Error("refresh failed")),
    showToast: message => messages.push(message),
    console: { error() {} }, Promise, Array, Date, Object
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.submit = onFormSubmit;", context);
  context.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  return { closed, message: messages[messages.length - 1] };
}

function refreshHarness() {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const start = source.indexOf("  function refreshProjects()");
  const end = source.indexOf("  function closeProjectDialog()", start);
  assert.ok(start >= 0 && end > start);
  const pending = new Map();
  const context = {
    projects: [], projectSnapshots: new Map(), refreshSequence: 0, active: "local",
    storageContext() { return { key: context.active }; },
    isCurrentContext(value) { return value.key === context.active; },
    getAllProjects(value) { return new Promise(resolve => pending.set(value.key, resolve)); },
    renderProjects() {}, Blob, Map, Array, Object, Date
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.refresh = refreshProjects;", context);
  return { context, pending };
}

async function saveSketchAndObserve(sameData, previousConstruction) {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const start = source.indexOf("  function saveRenderedPattern()");
  const end = source.indexOf("  function downloadRenderedSvg()", start);
  assert.ok(start >= 0 && end > start);
  const sketch = { shape: "triangle", detailRows: 3, selectedStitchIds: ["chain"] };
  let saved;
  const messages = [];
  const context = {
    renderedPattern: { id: "pattern-p1", projectId: "p1", sketch, construction: { rounds: [] }, sourceImages: [] },
    patternSnapshot: { id: "pattern-p1", projectId: "p1", sketch, construction: previousConstruction, sourceImages: [], corrections: ["conservar"] },
    patternContext: {}, patternLoadSequence: 1,
    isCurrentContext: () => true,
    diagramEngine: {
      validate: () => ({ errors: [], warnings: [] }),
      createSketch: () => ({ construction: { rounds: [] } })
    },
    firebaseService: { sameData },
    elements: { diagramProjectSelect: { value: "p1" }, diagramSaveButton: { disabled: false } },
    savePattern(value) { saved = value; return Promise.resolve(); },
    showDiagramMessages(errors, warnings, success) { messages.push(errors.join(" ") || success); },
    showToast() {}, console: { error() {} }, Promise, Object
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.save = saveRenderedPattern;", context);
  context.save();
  await new Promise(resolve => setImmediate(resolve));
  return { saved, messages };
}

test("saved and legacy documents retain extra fields", async () => {
  const { service, documents } = createService();
  const key = "users/user-1/projects/p1";
  const original = project();
  documents.set(key, original);
  const edited = { ...original, name: "Editado" };
  await service.saveProject("user-1", edited, original, () => true);
  assert.equal(documents.get(key).name, "Editado");
  assert.deepEqual(documents.get(key).extra, { note: "conservar" });
  const local = localHarness(service.sameData);
  local.stores.projects.set("p1", { ...original, photos: [{ id: "photo", blob: new Blob(["real"]) }] });
  const snapshot = structuredClone(local.stores.projects.get("p1"));
  const editedLocal = { ...snapshot, name: "Local editado" };
  await local.run([{ store: "projects", key: "p1", expected: snapshot }], [{ store: "projects", value: editedLocal }], {});
  assert.equal(local.stores.projects.get("p1").name, "Local editado");
  assert.equal(await local.stores.projects.get("p1").photos[0].blob.text(), "real");
  assert.deepEqual(local.stores.projects.get("p1").extra, { note: "conservar" });
  const refresh = refreshHarness();
  refresh.context.projects = [{ ...project(), photos: [{ id: "photo", blob: new Blob(["vieja"]) }] }];
  const reading = refresh.context.refresh();
  refresh.pending.get("local")([{ ...project(), photos: [{ id: "photo", blob: new Blob(["nueva"]) }] }]);
  await reading;
  assert.equal(await refresh.context.projects[0].photos[0].blob.text(), "nueva");
});

test("partial uploads are retained and failed writes are reported", async () => {
  const env = createService();
  const data = { ...project(), photos: [{ id: "photo-1", blob: new Blob(["image"], { type: "image/png" }) }] };
  env.setWriteFailure(true);
  await assert.rejects(env.service.saveProject("user-1", data, null, () => true), /write failed/);
  assert.equal(env.uploads.length, 1);
  assert.ok(data.photos[0].downloadUrl);
  env.setWriteFailure(false);
  await env.service.saveProject("user-1", data, null, () => true);
  assert.equal(env.uploads.length, 1);
  const refreshFailure = await submitAndObserve(false);
  assert.equal(refreshFailure.closed, true);
  assert.match(refreshFailure.message, /guardado.*lista/i);
  const saveFailure = await submitAndObserve(true);
  assert.equal(saveFailure.closed, false);
  assert.match(saveFailure.message, /save failed/);
  const partial = createService();
  const photos = [{ id: "ok", blob: new Blob(["1"]) }, { id: "bad", blob: new Blob(["2"]) }];
  partial.setUploadFailure(key => key.includes("/bad-"));
  await assert.rejects(partial.service.saveProject("user-1", { ...project(), photos }, null, () => true), /sin asociar/);
  assert.ok(photos[0].downloadUrl);
  assert.equal(photos[1].downloadUrl, undefined);
  const missingUrl = createService();
  const retry = { ...project(), photos: [{ id: "p", blob: new Blob(["1"]) }] };
  missingUrl.setDownloadFailure(true);
  await assert.rejects(missingUrl.service.saveProject("user-1", retry, null, () => true), /sin asociar/);
  assert.ok(retry.photos[0].storagePath);
  missingUrl.setDownloadFailure(false);
  await missingUrl.service.saveProject("user-1", retry, null, () => true);
  assert.equal(missingUrl.uploads.length, 1);
});

test("conflicting project and pattern writes do not replace newer data", async () => {
  const env = createService();
  const key = "users/user-1/projects/p1";
  const patternKey = "users/user-1/patterns/pattern-p1";
  const original = project();
  env.documents.set(key, { ...original, name: "Otra edición" });
  await assert.rejects(env.service.saveProject("user-1", original, original, () => true), /cambió/i);
  assert.equal(env.documents.get(key).name, "Otra edición");
  env.documents.set(patternKey, { id: "pattern-p1", projectId: "p1", note: "otro" });
  await assert.rejects(env.service.savePattern("user-1", { id: "pattern-p1", projectId: "p1" }, null, () => true), /cambió/i);
  assert.equal(env.documents.get(patternKey).note, "otro");
  const customised = await saveSketchAndObserve(env.service.sameData, { rounds: [{ note: "conservar" }] });
  assert.equal(customised.saved, undefined);
  assert.match(customised.messages.join(" "), /no se sobrescribirá/i);
  const normal = await saveSketchAndObserve(env.service.sameData, { rounds: [] });
  assert.deepEqual(normal.saved.corrections, ["conservar"]);
  const local = localHarness(env.service.sameData);
  local.stores.projects.set("p1", { ...original, name: "Otra edición" });
  await assert.rejects(local.run([{ store: "projects", key: "p1", expected: original }], [{ store: "projects", value: original }], {}), /cambió/i);
  assert.equal(local.stores.projects.get("p1").name, "Otra edición");
});

test("project deletion is atomic and never removes storage objects", async () => {
  const env = createService();
  const original = project();
  const key = "users/user-1/projects/p1";
  const patternKey = "users/user-1/patterns/pattern-p1";
  const pattern = { id: "pattern-p1", projectId: "p1" };
  env.documents.set(key, original);
  env.documents.set(patternKey, pattern);
  env.setWriteFailure(true);
  await assert.rejects(env.service.deleteProject("user-1", "p1", original, pattern, () => true), /write failed/);
  assert.ok(env.documents.has(key) && env.documents.has(patternKey));
  env.setWriteFailure(false);
  await env.service.deleteProject("user-1", "p1", original, pattern, () => true);
  assert.equal(env.documents.has(key), false);
  assert.equal(env.documents.has(patternKey), false);
  assert.equal(env.uploads.length, 0);
  const local = localHarness(env.service.sameData);
  local.stores.projects.set("p1", original);
  local.stores.patterns.set("pattern-p1", pattern);
  await assert.rejects(local.run([
    { store: "projects", key: "p1", expected: original },
    { store: "patterns", key: "pattern-p1", expected: null }
  ], [
    { store: "projects", key: "p1", remove: true },
    { store: "patterns", key: "pattern-p1", remove: true }
  ], {}), /cambió/i);
  assert.ok(local.stores.projects.has("p1") && local.stores.patterns.has("pattern-p1"));
});

test("a changed storage context prevents writes", async () => {
  const env = createService();
  env.setUser({ uid: "user-2" });
  await assert.rejects(env.service.saveProject("user-1", project(), null, () => false), /sesión|almacenamiento/i);
  assert.equal(env.documents.size, 0);
  const local = localHarness(env.service.sameData);
  local.setCurrent(false);
  await assert.rejects(local.run([{ store: "projects", key: "p1", expected: null }], [{ store: "projects", value: project() }], {}), /almacenamiento/i);
  assert.equal(local.stores.projects.size, 0);
  const refresh = refreshHarness();
  const older = refresh.context.refresh();
  refresh.context.active = "cloud:user-2";
  const newer = refresh.context.refresh();
  refresh.pending.get("cloud:user-2")([{ ...project(), name: "Nube" }]);
  await newer;
  refresh.pending.get("local")([{ ...project(), name: "Local" }]);
  await older;
  assert.equal(refresh.context.projects[0].name, "Nube");
});

test("document comparison checks blob content and fails closed on unsupported values", async () => {
  const { service } = createService();
  assert.equal(await service.sameData({ photo: new Blob(["abc"]) }, { photo: new Blob(["abc"]) }), true);
  assert.equal(await service.sameData({ photo: new Blob(["abc"]) }, { photo: new Blob(["xyz"]) }), false);
  assert.equal(await service.sameData({ a: 1 }, { a: 2 }), false);
  await assert.rejects(service.sameData(new Map([[1, 2]]), new Map([[1, 2]])), /comparar/i);
});

test("reconstruction persists and reopens without losing evidence, outputs or revisions", async () => {
  const env = createService();
  const original = { ...project(), photos: [{ id: "p", downloadUrl: "https://example.invalid/p" }] };
  const record = {
    id: "reconstruction-p1", projectId: "p1", formatVersion: 1,
    findings: [{ id: "f", photoId: "p", corrections: [{ before: "a", after: "b" }] }],
    logicalDocument: { revision: { id: "r2", parentId: "r1" } },
    outputs: { status: "incomplete", instructions: "Fila 1", svg: "<svg/>" },
    revisions: [{ id: "v1", logicalDocument: { revision: { id: "r1" } } }]
  };
  const projectKey = "users/user-1/projects/p1";
  const reconstructionKey = "users/user-1/patterns/reconstruction-p1";
  env.documents.set(projectKey, original);
  await env.service.saveReconstruction("user-1", record, null, original, () => true);
  assert.deepEqual(await env.service.getPattern("user-1", record.id), record);
  await assert.rejects(env.service.saveReconstruction("user-1", { ...record, findings: [] }, null, original, () => true), /cambió/i);
  await assert.rejects(env.service.deleteProject("user-1", "p1", original, null, () => true), /reconstrucciones/i);
  await assert.rejects(env.service.saveProject("user-1", { ...original, photos: [] }, original, () => true), /fotografías/i);
  assert.deepEqual(env.documents.get(reconstructionKey), record);
  assert.deepEqual(env.documents.get(projectKey), original);
  await assert.rejects(env.service.saveReconstruction("user-1", record, record, original, () => false), /sesión|almacenamiento/i);
  env.setWriteFailure(true);
  await assert.rejects(env.service.saveReconstruction("user-1", { ...record, outputs: {} }, record, original, () => true), /write failed/);
  assert.deepEqual(env.documents.get(reconstructionKey), record);

  const local = localHarness(env.service.sameData);
  local.stores.projects.set("p1", original);
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
  const start = source.indexOf("  function saveProject(");
  const end = source.indexOf("  function escapeHtml(", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    localTransaction: local.run, isCurrentContext: () => true, firebaseService: env.service,
    STORE_NAME: "projects", PATTERN_STORE_NAME: "patterns", Promise, Array, Error
  };
  vm.runInNewContext(source.slice(start, end) + "\nthis.save = saveReconstruction; this.remove = deleteProject; this.edit = saveProject;", context);
  await context.save(record, null, original, { key: "local" });
  assert.deepEqual(local.stores.patterns.get(record.id), record);
  await assert.rejects(context.save(record, null, original, { key: "local" }), /cambió/i);
  await assert.rejects(context.remove("p1", original, null, { key: "local" }), /cambió/i);
  await assert.rejects(context.edit({ ...original, photos: [] }, original, { key: "local" }), /cambió/i);
  assert.deepEqual(local.stores.patterns.get(record.id), record);
  assert.deepEqual(local.stores.projects.get("p1"), original);
});
