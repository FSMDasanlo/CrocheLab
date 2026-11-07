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

  function uploadPhoto(userId, projectId, photo) {
    if (!storage) return Promise.reject(new Error("Cloud Storage no disponible."));
    if (!photo.blob) {
      return Promise.resolve(photo);
    }
    const filename = (photo.id || crypto.randomUUID()) + ".jpg";
    const path = "users/" + encodeURIComponent(userId) + "/projects/" + encodeURIComponent(projectId) + "/photos/" + filename;
    const storageRef = storage.ref(path);
    return storageRef.put(photo.blob, { contentType: photo.blob.type || "image/jpeg" })
      .then(function (snapshot) {
        return snapshot.ref.getDownloadURL();
      })
      .then(function (downloadUrl) {
        return {
          id: photo.id,
          name: photo.name || "Fotografía",
          label: photo.label || "",
          storagePath: path,
          downloadUrl: downloadUrl,
          blob: photo.blob
        };
      });
  }

  function deletePhotos(photos) {
    if (!storage || !Array.isArray(photos)) return Promise.resolve();
    const promises = photos.map(function (photo) {
      if (photo && photo.storagePath) {
        return storage.ref(photo.storagePath).delete().catch(function (err) {
          console.warn("No se pudo borrar foto de Storage:", photo.storagePath, err);
        });
      }
      return Promise.resolve();
    });
    return Promise.all(promises);
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

  function saveProject(userId, project) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    const uploadPromises = (project.photos || []).map(function (photo) {
      if (photo.blob && !photo.downloadUrl) {
        return uploadPhoto(userId, project.id, photo);
      }
      return Promise.resolve({
        id: photo.id,
        name: photo.name || "Fotografía",
        label: photo.label || "",
        storagePath: photo.storagePath || null,
        downloadUrl: photo.downloadUrl || null,
        blob: photo.blob || null
      });
    });

    return Promise.all(uploadPromises).then(function (uploadedPhotos) {
      const docData = {
        id: project.id,
        name: project.name,
        garment: project.garment,
        description: project.description || "",
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        photos: uploadedPhotos.map(function (p) {
          return {
            id: p.id,
            name: p.name,
            label: p.label,
            storagePath: p.storagePath || null,
            downloadUrl: p.downloadUrl || null
          };
        })
      };
      return db.collection("users").doc(userId).collection("projects").doc(project.id).set(docData)
        .then(function () {
          project.photos = uploadedPhotos;
          return project;
        });
    });
  }

  function deleteProject(userId, projectId, existingPhotos) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    const deleteDocPromise = db.collection("users").doc(userId).collection("projects").doc(projectId).delete();
    const deletePatternPromise = db.collection("users").doc(userId).collection("patterns").doc("pattern-" + projectId).delete().catch(function () {});
    const deleteStoragePromise = deletePhotos(existingPhotos);
    return Promise.all([deleteDocPromise, deletePatternPromise, deleteStoragePromise]);
  }

  function getPattern(userId, patternId) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    return db.collection("users").doc(userId).collection("patterns").doc(patternId).get()
      .then(function (doc) {
        return doc.exists ? doc.data() : null;
      });
  }

  function savePattern(userId, pattern) {
    if (!db) return Promise.reject(new Error("Firestore no disponible."));
    const docId = pattern.id || ("pattern-" + pattern.projectId);
    return db.collection("users").doc(userId).collection("patterns").doc(docId).set(pattern);
  }

  function ensurePhotoBlob(photo) {
    if (photo.blob instanceof Blob) return Promise.resolve(photo.blob);
    if (!photo.downloadUrl) return Promise.reject(new Error("Fotografía sin URL de descarga."));
    return fetch(photo.downloadUrl)
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
    getAllProjects: getAllProjects,
    saveProject: saveProject,
    deleteProject: deleteProject,
    getPattern: getPattern,
    savePattern: savePattern,
    ensurePhotoBlob: ensurePhotoBlob
  });
})();
