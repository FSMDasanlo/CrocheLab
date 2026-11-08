(function () {
  "use strict";

  let isInitialized = false;
  let auth = null;
  let db = null;
  let storage = null;
  let currentUser = null;
  const authListeners = [];

  function init() {
    const config = window.CROCHELAB_FIREBASE_CONFIG;
    if (!config || !config.apiKey || !config.projectId || typeof firebase === "undefined") {
      return false;
    }
    if (!isInitialized) {
      try {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(config);
        }
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();
        isInitialized = true;
        auth.onAuthStateChanged(function (user) {
          currentUser = user;
          authListeners.forEach(function (listener) {
            try { listener(user); } catch (e) { console.error("Error en observador de autenticación:", e); }
          });
        });
      } catch (error) {
        console.error("No se pudo inicializar Firebase:", error);
        return false;
      }
    }
    return isInitialized;
  }

  function onAuthChange(callback) {
    authListeners.push(callback);
    if (isInitialized) {
      callback(currentUser);
    }
  }

  function loginWithGoogle() {
    if (!init() || !auth) {
      return Promise.reject(new Error("El servicio de autenticación no está disponible. Revisa la configuración de Firebase."));
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return auth.signInWithPopup(provider).catch(function (error) {
      if (error.code === "auth/popup-blocked" || error.code === "auth/cancelled-popup-request") {
        return auth.signInWithRedirect(provider);
      }
      throw error;
    });
  }

  function logout() {
    if (!auth) return Promise.resolve();
    return auth.signOut();
  }

  function getCurrentUser() {
    return currentUser;
  }

  function isCloudActive() {
    return Boolean(isInitialized && currentUser);
  }

  async function sameData(left, right, seen) {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
    if (left instanceof Blob || right instanceof Blob) {
      if (!(left instanceof Blob) || !(right instanceof Blob) || left.size !== right.size || left.type !== right.type) return false;
      if (left.name !== right.name || left.lastModified !== right.lastModified) return false;
      for (let offset = 0; offset < left.size; offset += 262144) {
        const contents = await Promise.all([
          left.slice(offset, offset + 262144).arrayBuffer(),
          right.slice(offset, offset + 262144).arrayBuffer()
        ]);
        const a = new Uint8Array(contents[0]);
        const b = new Uint8Array(contents[1]);
        if (!a.every(function (value, index) { return value === b[index]; })) return false;
      }
      return true;
    }
    if (typeof left.isEqual === "function" && typeof right.isEqual === "function") return left.isEqual(right);
    if (left instanceof Date || right instanceof Date) {
      return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    }
    const leftArray = Array.isArray(left);
    if (leftArray !== Array.isArray(right)) return false;
    if (leftArray && left.length !== right.length) return false;
    if (!leftArray && (Object.prototype.toString.call(left) !== "[object Object]" ||
        Object.prototype.toString.call(right) !== "[object Object]" ||
        (Object.getPrototypeOf(left) && Object.getPrototypeOf(left).constructor.name !== "Object") ||
        (Object.getPrototypeOf(right) && Object.getPrototypeOf(right).constructor.name !== "Object"))) {
      throw new Error("No se pueden comparar todos los datos guardados de forma segura.");
    }
    seen = seen || new WeakMap();
    if (seen.has(left)) return seen.get(left) === right;
    seen.set(left, right);
    const keys = Object.keys(left);
    const otherKeys = Object.keys(right);
    if (keys.length !== otherKeys.length) return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(right, key) || !(await sameData(left[key], right[key], seen))) return false;
    }
    return true;
  }

  function assertCurrent(userId, isCurrent) {
    if (!currentUser || currentUser.uid !== userId || typeof isCurrent !== "function" || !isCurrent()) {
      throw new Error("La sesión o el almacenamiento ha cambiado. La operación puede haber quedado incompleta.");
    }
  }

  async function assertUnchanged(snapshot, expected) {
    if (expected === undefined || !(await sameData(snapshot.exists ? snapshot.data() : null, expected))) {
      throw new Error("El documento cambió desde que se abrió. Recarga antes de volver a intentarlo.");
    }
  }

  function uploadPhoto(userId, projectId, photo, onUploaded) {
    if (!storage) return Promise.reject(new Error("Cloud Storage no disponible."));
    if (!photo.blob) {
      return Promise.resolve(photo);
    }
    const path = photo.storagePath || ("users/" + encodeURIComponent(userId) + "/projects/" +
      encodeURIComponent(projectId) + "/photos/" + photo.id + "-" + crypto.randomUUID() + ".jpg");
    const reference = storage.ref(path);
    const uploaded = photo.storagePath
      ? Promise.resolve(reference)
      : reference.put(photo.blob, { contentType: photo.blob.type || "image/jpeg" }).then(function (snapshot) {
        photo.storagePath = path;
        if (onUploaded) onUploaded(photo);
        return snapshot.ref;
      });
    return uploaded.then(function (ref) { return ref.getDownloadURL(); })
      .then(function (downloadUrl) {
        return Object.assign({}, photo, {
          id: photo.id,
          name: photo.name || "Fotografía",
          label: photo.label || "",
          storagePath: path,
          downloadUrl: downloadUrl,
          blob: photo.blob
        });
      });
  }

  function getAllProjects(userId) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    return db.collection("users").doc(userId).collection("projects").get()
      .then(function (snapshot) {
        const list = [];
        snapshot.forEach(function (doc) {
          const data = doc.data();
          list.push(data);
        });
        return list;
      });
  }

  async function saveProject(userId, project, expected, isCurrent, onPhotoUploaded) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    assertCurrent(userId, isCurrent);
    let uploadedAny = false;
    const uploadPromises = (project.photos || []).map(function (photo) {
      if (photo.blob && !photo.downloadUrl) {
        return uploadPhoto(userId, project.id, photo, function (partial) {
          uploadedAny = true;
          if (onPhotoUploaded) onPhotoUploaded(partial);
        }).then(function (uploaded) {
          Object.assign(photo, uploaded);
          uploadedAny = true;
          if (onPhotoUploaded) onPhotoUploaded(uploaded);
          return uploaded;
        });
      }
      return Promise.resolve(photo);
    });
    const results = await Promise.allSettled(uploadPromises);
    const failure = results.find(function (result) { return result.status === "rejected"; });
    if (failure) throw new Error("No se pudo completar la subida. Puede haber fotografías sin asociar; no se ha borrado ninguna. " + failure.reason.message);
    assertCurrent(userId, isCurrent);
    const docData = Object.assign({}, expected || {}, project, {
      photos: project.photos.map(function (photo) {
        const saved = Object.assign({}, photo);
        delete saved.blob;
        return saved;
      })
    });
    const reference = db.collection("users").doc(userId).collection("projects").doc(project.id);
    const removedPhoto = expected && Array.isArray(expected.photos) && expected.photos.some(function (photo) {
      return !project.photos.some(function (item) { return item.id === photo.id; });
    });
    try {
      await db.runTransaction(async function (transaction) {
        const snapshot = await transaction.get(reference);
        await assertUnchanged(snapshot, expected);
        if (removedPhoto) {
          const reconstruction = await transaction.get(db.collection("users").doc(userId).collection("patterns").doc("reconstruction-" + project.id));
          if (reconstruction.exists) throw new Error("No se pueden retirar fotografías de un proyecto con reconstrucciones guardadas.");
        }
        assertCurrent(userId, isCurrent);
        transaction.set(reference, docData);
      });
    } catch (error) {
      if (uploadedAny) {
        throw new Error("No se pudo confirmar la asociación de fotografías; pueden quedar archivos sin asociar. " + error.message);
      }
      throw error;
    }
    return project;
  }

  function deleteProject(userId, projectId, expected, expectedPattern, isCurrent) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    const user = db.collection("users").doc(userId);
    const projectRef = user.collection("projects").doc(projectId);
    const patternRef = user.collection("patterns").doc("pattern-" + projectId);
    const reconstructionRef = user.collection("patterns").doc("reconstruction-" + projectId);
    return db.runTransaction(async function (transaction) {
      assertCurrent(userId, isCurrent);
      const snapshots = await Promise.all([transaction.get(projectRef), transaction.get(patternRef), transaction.get(reconstructionRef)]);
      await assertUnchanged(snapshots[0], expected);
      await assertUnchanged(snapshots[1], expectedPattern);
      if (snapshots[2].exists) throw new Error("El proyecto tiene reconstrucciones guardadas y no se puede eliminar.");
      assertCurrent(userId, isCurrent);
      transaction.delete(projectRef);
      if (snapshots[1].exists) transaction.delete(patternRef);
    });
  }

  function getPattern(userId, patternId) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    return db.collection("users").doc(userId).collection("patterns").doc(patternId).get()
      .then(function (doc) {
        return doc.exists ? doc.data() : null;
      });
  }

  function savePattern(userId, pattern, expected, isCurrent) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    const docId = pattern.id || ("pattern-" + pattern.projectId);
    const reference = db.collection("users").doc(userId).collection("patterns").doc(docId);
    return db.runTransaction(async function (transaction) {
      assertCurrent(userId, isCurrent);
      const snapshot = await transaction.get(reference);
      await assertUnchanged(snapshot, expected);
      assertCurrent(userId, isCurrent);
      transaction.set(reference, pattern);
    });
  }

  function saveReconstruction(userId, reconstruction, expected, expectedProject, isCurrent) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    const user = db.collection("users").doc(userId);
    const projectRef = user.collection("projects").doc(reconstruction.projectId);
    const reference = user.collection("patterns").doc(reconstruction.id);
    return db.runTransaction(async function (transaction) {
      assertCurrent(userId, isCurrent);
      const snapshots = await Promise.all([transaction.get(projectRef), transaction.get(reference)]);
      await assertUnchanged(snapshots[0], expectedProject);
      await assertUnchanged(snapshots[1], expected);
      if (!snapshots[0].exists) throw new Error("El proyecto ya no existe.");
      assertCurrent(userId, isCurrent);
      transaction.set(reference, reconstruction);
    });
  }

  function ensurePhotoBlob(photo) {
    if (photo.blob instanceof Blob) return Promise.resolve(photo.blob);
    if (!photo.downloadUrl) return Promise.reject(new Error("Fotografía sin URL de descarga."));
    return fetch(photo.downloadUrl, { mode: "cors" })
      .then(function (res) {
        if (!res.ok) throw new Error("No se pudo descargar la imagen (" + res.status + ").");
        return res.blob();
      })
      .then(function (blob) {
        photo.blob = blob;
        return blob;
      });
  }

  window.CrocheLabFirebase = Object.freeze({
    init: init,
    onAuthChange: onAuthChange,
    loginWithGoogle: loginWithGoogle,
    logout: logout,
    getCurrentUser: getCurrentUser,
    isCloudActive: isCloudActive,
    sameData: sameData,
    getAllProjects: getAllProjects,
    saveProject: saveProject,
    deleteProject: deleteProject,
    getPattern: getPattern,
    savePattern: savePattern,
    saveReconstruction: saveReconstruction,
    ensurePhotoBlob: ensurePhotoBlob
  });
})();
