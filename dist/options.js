(() => {
  // src/errors.js
  var ErrorKind = Object.freeze({
    SOURCE: "source",
    COMPATIBILITY: "compatibility",
    UNSUPPORTED: "unsupported",
    CANCELED: "canceled",
    INTERNAL: "internal"
  });
  var RPlayError = class extends Error {
    constructor(message2, code, options = {}) {
      super(message2, options);
      this.name = this.constructor.name;
      this.code = code;
      this.kind = options.kind || ErrorKind.INTERNAL;
    }
  };
  var SourceError = class extends RPlayError {
    constructor(message2, code = "SOURCE_ERROR", options) {
      super(message2, code, { ...options, kind: ErrorKind.SOURCE });
      this.isSourceError = true;
    }
  };

  // src/cdm-protobuf.js
  var concatBytes = (...parts) => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  };
  var hexBytes = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  function parseFields(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 512 * 1024) throw new Error("Invalid protobuf size");
    const fields = /* @__PURE__ */ new Map();
    let offset = 0, count = 0;
    const readInteger = () => {
      let value = 0n;
      for (let index = 0; index < 10; index++) {
        if (offset >= bytes.length) throw new Error("Truncated protobuf");
        const byte = bytes[offset++];
        if (index === 9 && byte > 1) throw new Error("Invalid protobuf integer");
        value |= BigInt(byte & 127) << BigInt(index * 7);
        if (!(byte & 128)) return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
      }
      throw new Error("Invalid protobuf varint");
    };
    while (offset < bytes.length) {
      if (++count > 8192) throw new Error("Too many protobuf fields");
      const tag = readInteger();
      if (typeof tag !== "number" || tag < 8 || tag > 4294967295) throw new Error("Invalid protobuf tag");
      const id = Math.floor(tag / 8), wire = tag % 8;
      let value;
      if (wire === 0) value = readInteger();
      else {
        const length = wire === 1 ? 8 : wire === 5 ? 4 : wire === 2 ? readInteger() : -1;
        if (typeof length !== "number" || length < 0 || length > bytes.length - offset) throw new Error("Invalid protobuf length");
        value = bytes.subarray(offset, offset + length);
        offset += length;
      }
      if (!fields.has(id)) fields.set(id, []);
      fields.get(id).push({ wire, value });
    }
    return fields;
  }
  function oneField(fields, id, wire, fallback) {
    const entries = fields.get(id);
    if (!entries) {
      if (fallback !== void 0) return fallback;
      throw new Error("Missing protobuf field");
    }
    if (entries.length !== 1 || entries[0].wire !== wire) throw new Error("Ambiguous protobuf field");
    return entries[0].value;
  }

  // src/cdm-crypto.js
  var zeroBlock = new Uint8Array(16);
  function der(tag, value) {
    const length = [];
    if (value.length < 128) length.push(value.length);
    else {
      let remaining = value.length;
      while (remaining) {
        length.unshift(remaining % 256);
        remaining = Math.floor(remaining / 256);
      }
      length.unshift(128 | length.length);
    }
    return concatBytes(new Uint8Array([tag, ...length]), value);
  }
  var rsaAlgorithm = new Uint8Array([48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0]);
  var wrapPrivateKey = (pkcs1) => der(48, concatBytes(new Uint8Array([2, 1, 0]), rsaAlgorithm, der(4, pkcs1)));
  var wrapPublicKey = (pkcs1) => der(48, concatBytes(rsaAlgorithm, der(3, concatBytes(new Uint8Array([0]), pkcs1))));

  // src/cdm-browser.js
  var MAX_DEVICE_BYTES = 256 * 1024;
  var pss = { name: "RSA-PSS", saltLength: 20 };
  var readBytes = (message2, id, fallback) => oneField(message2, id, 2, fallback);
  var readNumber = (message2, id, fallback) => oneField(message2, id, 0, fallback);
  async function importWvd(source) {
    const bytes = new Uint8Array(source);
    let pkcs8;
    try {
      if (bytes.length < 12 || bytes.length > MAX_DEVICE_BYTES || hexBytes(bytes.subarray(0, 3)) !== "575644") {
        throw new Error("Invalid WVD");
      }
      if (bytes[3] !== 2) throw new SourceError("\u5F53\u524D\u652F\u6301 WVD v2 \u8BBE\u5907\u6587\u4EF6", "WVD_VERSION_UNSUPPORTED");
      const type = bytes[4], securityLevel = bytes[5];
      if (![1, 2].includes(type) || securityLevel < 1 || securityLevel > 3 || bytes[6] !== 0) throw new Error("Invalid WVD header");
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const privateSize = view.getUint16(7);
      const clientOffset = 9 + privateSize;
      if (privateSize < 128 || clientOffset + 2 > bytes.length) throw new Error("Invalid WVD key");
      const clientSize = view.getUint16(clientOffset);
      if (!clientSize || clientOffset + 2 + clientSize !== bytes.length) throw new Error("Invalid WVD client");
      const clientId = bytes.slice(clientOffset + 2);
      const certificate = parseFields(readBytes(parseFields(readBytes(parseFields(clientId), 2)), 1));
      const publicBytes = readBytes(certificate, 4);
      const systemId = readNumber(certificate, 5);
      if (!Number.isInteger(systemId) || systemId <= 0) throw new Error("Invalid device certificate");
      pkcs8 = wrapPrivateKey(bytes.subarray(9, clientOffset));
      const [signKey, decryptKey, publicKey] = await Promise.all([
        crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSA-PSS", hash: "SHA-1" }, false, ["sign"]),
        crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-1" }, false, ["decrypt"]),
        crypto.subtle.importKey("spki", wrapPublicKey(publicBytes), { name: "RSA-PSS", hash: "SHA-1" }, false, ["verify"])
      ]);
      if (signKey.algorithm.modulusLength < 2048) throw new Error("Invalid RSA size");
      const proof = crypto.getRandomValues(new Uint8Array(32));
      const signature = await crypto.subtle.sign(pss, signKey, proof);
      if (!await crypto.subtle.verify(pss, publicKey, signature, proof)) throw new Error("Device key mismatch");
      return { schema: 1, type, securityLevel, systemId, clientId, signKey, decryptKey, importedAt: Date.now() };
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError("\u8BBE\u5907\u6587\u4EF6\u65E0\u6548\uFF0C\u6216\u8BBE\u5907\u79C1\u94A5\u4E0E\u8BC1\u4E66\u4E0D\u5339\u914D", "WVD_INVALID");
    } finally {
      bytes.fill(0);
      pkcs8?.fill(0);
    }
  }

  // src/cdm-device-store.js
  async function deviceTransaction(mode, action) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("rplay-cdm", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("devices");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database blocked"));
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction2 = database.transaction("devices", mode);
        const request = action(transaction2.objectStore("devices"));
        transaction2.oncomplete = () => resolve(request.result ?? null);
        transaction2.onerror = transaction2.onabort = () => reject(transaction2.error);
      });
    } finally {
      database.close();
    }
  }
  async function loadDevice() {
    let device;
    try {
      device = await deviceTransaction("readonly", (store) => store.get("active"));
    } catch {
      throw new SourceError("\u65E0\u6CD5\u8BFB\u53D6 DRM \u8BBE\u5907\uFF0C\u8BF7\u91CD\u65B0\u5BFC\u5165", "CDM_STORAGE_ERROR");
    }
    if (device) return device;
    const bundled = await readBundledDevice();
    const existing = await deviceTransaction("readwrite", (store) => {
      const request = store.get("active");
      request.onsuccess = () => {
        if (!request.result) store.put(bundled, "active");
      };
      return request;
    });
    return existing || bundled;
  }
  async function saveDevice(device) {
    try {
      await deviceTransaction("readwrite", (store) => store.put(device, "active"));
    } catch {
      throw new SourceError("\u8BBE\u5907\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u672C\u5730\u5B58\u50A8", "CDM_STORAGE_ERROR");
    }
  }
  async function readBundledDevice() {
    let response;
    try {
      response = await fetch(chrome.runtime.getURL("private/device.wvd"));
    } catch {
      throw new SourceError("\u672A\u627E\u5230\u5185\u7F6E\u8BBE\u5907\uFF0C\u8BF7\u5BFC\u5165 .wvd \u6587\u4EF6", "CDM_NOT_CONFIGURED");
    }
    if (!response.ok) throw new SourceError("\u672A\u627E\u5230\u5185\u7F6E\u8BBE\u5907\uFF0C\u8BF7\u5BFC\u5165 .wvd \u6587\u4EF6", "CDM_NOT_CONFIGURED");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_DEVICE_BYTES) throw new SourceError("\u8BBE\u5907\u6587\u4EF6\u8FC7\u5927", "WVD_INVALID");
    return { ...await importWvd(buffer), bundled: true };
  }
  async function restoreBundledDevice() {
    const device = await readBundledDevice();
    await saveDevice(device);
    return device;
  }

  // src/output-template.js
  var DEFAULT_OUTPUT_TEMPLATE = "%(title)s_%(resolution)s_%(upload_date>%Y-%m-%dT%H-%M-%S)s.%(ext)s";
  var PLACEHOLDER = /^(?:\.(\d+))?([sB])/;
  function pad(value, length = 2) {
    return String(value).padStart(length, "0");
  }
  function formatDate(date, format) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const year = date.getUTCFullYear();
    const tokens = {
      "%Y": String(year),
      "%y": pad(year % 100),
      "%m": pad(date.getUTCMonth() + 1),
      "%d": pad(date.getUTCDate()),
      "%H": pad(date.getUTCHours()),
      "%M": pad(date.getUTCMinutes()),
      "%S": pad(date.getUTCSeconds()),
      "%j": pad(Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 0)) / 864e5), 3),
      "%%": "%"
    };
    return String(format).replace(/%[YymdHMSj%]/g, (token) => tokens[token] ?? token);
  }
  function truncateCharacters(value, limit) {
    return [...value].slice(0, limit).join("");
  }
  function truncateBytes(value, limit) {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length <= limit) return value;
    let end = limit;
    while (end > 0 && (bytes[end] & 192) === 128) end -= 1;
    return new TextDecoder().decode(bytes.subarray(0, end));
  }
  function resolveExpression(fields, expression) {
    const gt = expression.indexOf(">");
    const name = (gt >= 0 ? expression.slice(0, gt) : expression).trim();
    const format = gt >= 0 ? expression.slice(gt + 1) : null;
    const raw = fields[name];
    if (raw === void 0 || raw === null) return "";
    if (raw instanceof Date) return formatDate(raw, format || "%Y%m%d");
    return String(raw);
  }
  function renderField(body, limit, fields) {
    const separator = body.indexOf("|");
    const expressions = separator >= 0 ? body.slice(0, separator) : body;
    const fallback = separator >= 0 ? body.slice(separator + 1) : null;
    let value = "";
    for (const alternative of expressions.split(",")) {
      value = resolveExpression(fields, alternative);
      if (value !== "") break;
    }
    if (value === "" && fallback !== null) value = fallback;
    if (value === "" || !limit) return value;
    return limit.bytes ? truncateBytes(value, limit.value) : truncateCharacters(value, limit.value);
  }
  function renderTemplate(template, fields = {}) {
    const source = String(template ?? "");
    let output = "";
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf("%(", cursor);
      if (start < 0) {
        output += source.slice(cursor);
        break;
      }
      const end = source.indexOf(")", start + 2);
      if (end < 0) {
        output += source.slice(cursor);
        break;
      }
      const spec = PLACEHOLDER.exec(source.slice(end + 1));
      if (!spec) {
        output += source.slice(cursor, end + 1);
        cursor = end + 1;
        continue;
      }
      const limit = spec[1] ? { value: Number(spec[1]), bytes: spec[2] === "B" } : null;
      output += source.slice(cursor, start);
      output += renderField(source.slice(start + 2, end), limit, fields);
      cursor = end + 1 + spec[0].length;
    }
    return output;
  }

  // src/naming.js
  function normalizeVideoTitle(value) {
    const normalized = String(value || "").normalize("NFC").replace(/\s+/g, " ").replace(/\s*[|｜]\s*RPLAY\s*$/i, "").trim();
    return /^(?:rplay|rplay\.live)$/i.test(normalized) ? "" : normalized;
  }
  var RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  function sanitizePathSegment(value) {
    const cleaned = String(value ?? "").normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").replace(/[. ]+$/g, "").trim();
    if (!cleaned || RESERVED_NAMES.test(cleaned)) return cleaned ? `_${cleaned}` : "";
    return [...cleaned].slice(0, 120).join("");
  }
  function toDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date;
  }
  function asFieldText(value) {
    return String(value ?? "").replace(/[\\/]+/g, "_");
  }
  function buildTemplateFields(task, extension) {
    return {
      title: asFieldText(normalizeVideoTitle(task?.title) || "rplay"),
      id: asFieldText(task?.videoId || ""),
      channel: asFieldText(task?.channel || ""),
      channel_id: asFieldText(task?.channelId || ""),
      upload_date: toDate(task?.createdAt),
      release_date: toDate(task?.releaseDate),
      resolution: asFieldText(task?.resolution || ""),
      width: task?.width || "",
      height: task?.height || "",
      duration: Number.isFinite(task?.duration) ? Math.round(task.duration) : "",
      ext: asFieldText(extension || "mp4")
    };
  }
  function splitSegments(value) {
    return String(value ?? "").split(/[\\/]+/);
  }
  function joinPath(segments) {
    return segments.join("/");
  }
  function buildDownloadPath(task, extension, settings) {
    const fields = buildTemplateFields(task, extension);
    const template = settings?.outputTemplate || DEFAULT_OUTPUT_TEMPLATE;
    const folderSegments = splitSegments(settings?.defaultFolder || "").map(sanitizePathSegment).filter(Boolean);
    const extensionSuffix = `.${fields.ext}`;
    const render = (candidate) => {
      const segments = splitSegments(renderTemplate(candidate, fields)).map(sanitizePathSegment).filter(Boolean);
      const name = segments.pop() || "";
      if (!name) return;
      const filename = name.toLowerCase().endsWith(extensionSuffix.toLowerCase()) ? name : `${name}${extensionSuffix}`;
      const directory = joinPath([...folderSegments, ...segments].filter(Boolean));
      const path = joinPath([directory, filename].filter(Boolean));
      return { path, directory, name: filename, basename: filename.slice(0, filename.length - extensionSuffix.length) };
    };
    return render(template) || render(DEFAULT_OUTPUT_TEMPLATE) || {
      path: `rplay_${fields.ext}`,
      directory: "",
      name: `rplay_${fields.ext}`,
      basename: "rplay"
    };
  }

  // src/output-directory.js
  var DB_NAME = "rplay-output";
  var STORE_NAME = "handles";
  var HANDLE_KEY = "output";
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function transaction(db, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = action(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request?.result ?? null);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async function saveDirectoryHandle(handle) {
    const db = await openDatabase();
    try {
      await transaction(db, "readwrite", (store) => store.put(handle, HANDLE_KEY));
    } finally {
      db.close();
    }
  }
  async function loadDirectoryHandle() {
    if (typeof indexedDB === "undefined") return null;
    let db;
    try {
      db = await openDatabase();
      return await transaction(db, "readonly", (store) => store.get(HANDLE_KEY));
    } catch {
      return null;
    } finally {
      db?.close();
    }
  }
  async function clearDirectoryHandle() {
    const db = await openDatabase();
    try {
      await transaction(db, "readwrite", (store) => store.delete(HANDLE_KEY));
    } finally {
      db.close();
    }
  }
  async function directoryPermission(handle, { request = false } = {}) {
    if (!handle?.queryPermission) return "unsupported";
    const query = { mode: "readwrite" };
    let state = await handle.queryPermission(query);
    if (state !== "granted" && request && handle.requestPermission) {
      state = await handle.requestPermission(query);
    }
    return state;
  }

  // src/settings.js
  var SETTINGS_KEY = "rplaySettings";
  var SAVE_MODES = Object.freeze(["folder", "ask"]);
  var EMBY_MEDIA_TYPES = Object.freeze(["tv", "movie"]);
  var DEFAULT_SETTINGS = Object.freeze({
    saveMode: "folder",
    defaultFolder: "RPlay",
    outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
    embyEnabled: true,
    embyMediaType: "tv",
    embyNfo: true,
    embyImages: true,
    useCustomDirectory: false
  });
  function normalizeString(value, fallback, { allowEmpty = true, limit = 512 } = {}) {
    if (typeof value !== "string") return fallback;
    const trimmed = value.replace(/\r\n?/g, "\n");
    const result = allowEmpty ? trimmed : trimmed.trim();
    if (!allowEmpty && result.trim() === "") return fallback;
    return [...result].slice(0, limit).join("");
  }
  function normalizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      saveMode: SAVE_MODES.includes(source.saveMode) ? source.saveMode : DEFAULT_SETTINGS.saveMode,
      defaultFolder: normalizeString(source.defaultFolder, DEFAULT_SETTINGS.defaultFolder),
      outputTemplate: normalizeString(source.outputTemplate, DEFAULT_SETTINGS.outputTemplate, { allowEmpty: false }),
      embyEnabled: typeof source.embyEnabled === "boolean" ? source.embyEnabled : DEFAULT_SETTINGS.embyEnabled,
      embyMediaType: EMBY_MEDIA_TYPES.includes(source.embyMediaType) ? source.embyMediaType : DEFAULT_SETTINGS.embyMediaType,
      embyNfo: typeof source.embyNfo === "boolean" ? source.embyNfo : DEFAULT_SETTINGS.embyNfo,
      embyImages: typeof source.embyImages === "boolean" ? source.embyImages : DEFAULT_SETTINGS.embyImages,
      useCustomDirectory: typeof source.useCustomDirectory === "boolean" ? source.useCustomDirectory : DEFAULT_SETTINGS.useCustomDirectory
    };
  }
  function storageArea() {
    if (typeof chrome === "undefined" || !chrome.storage) return null;
    return chrome.storage.sync || chrome.storage.local || null;
  }
  async function loadSettings() {
    const area = storageArea();
    if (!area) return { ...DEFAULT_SETTINGS };
    const stored = await area.get(SETTINGS_KEY).catch(() => ({}));
    return normalizeSettings(stored?.[SETTINGS_KEY]);
  }
  async function saveSettings(patch) {
    const current = await loadSettings();
    const next = normalizeSettings({ ...current, ...patch });
    const area = storageArea();
    if (area) await area.set({ [SETTINGS_KEY]: next });
    return next;
  }

  // src/options.js
  var field = (id) => document.getElementById(id);
  var message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = message(element.dataset.i18n) || element.textContent;
  }
  for (const element of document.querySelectorAll("[data-i18n-aria]")) {
    element.setAttribute("aria-label", message(element.dataset.i18nAria) || element.getAttribute("aria-label"));
  }
  document.documentElement.lang = chrome.i18n.getUILanguage?.().replaceAll("_", "-") || "zh-CN";
  document.title = `RPlay \xB7 ${message("drmSettings")}`;
  var isBusy = false;
  function showDevice(device) {
    field("deviceCard").dataset.state = "ready";
    field("deviceStatus").textContent = message(device.bundled ? "drmBundledReady" : "drmDeviceReady");
    field("deviceHint").textContent = message(device.bundled ? "drmBundledHint" : "drmCustomHint");
    field("restore").hidden = Boolean(device.bundled);
  }
  function showStatus(key, kind = "progress") {
    field("status").dataset.kind = kind;
    field("status").textContent = key ? message(key) : "";
  }
  function busy(value) {
    isBusy = value;
    field("save").disabled = value || !field("device").files.length;
    field("restore").disabled = value;
    field("device").disabled = value;
    field("settings").setAttribute("aria-busy", String(value));
  }
  function showSelection() {
    const file = field("device").files[0];
    field("selectedFile").hidden = !file;
    field("fileName").textContent = file?.name || "";
    field("fileSize").textContent = file ? `${(file.size / 1024).toFixed(1)} KB` : "";
    busy(isBusy);
  }
  busy(true);
  loadDevice().then(showDevice).catch(() => {
    field("deviceCard").dataset.state = "error";
    field("deviceStatus").textContent = message("drmMissingTitle");
    field("deviceHint").textContent = message("drmDeviceMissing");
    field("restore").hidden = false;
  }).finally(() => busy(false));
  field("device").addEventListener("change", () => {
    showSelection();
    showStatus("");
  });
  field("settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = field("device").files[0];
    if (!file || isBusy) return;
    busy(true);
    showStatus("drmChecking");
    let bytes;
    try {
      if (file.size > MAX_DEVICE_BYTES) throw new Error("Invalid file size");
      bytes = new Uint8Array(await file.arrayBuffer());
      const device = await importWvd(bytes);
      await saveDevice(device);
      showDevice(device);
      field("device").value = "";
      showSelection();
      showStatus("drmSaved", "success");
    } catch {
      showStatus("drmInvalidDevice", "error");
    } finally {
      bytes?.fill(0);
      busy(false);
    }
  });
  field("restore").addEventListener("click", async () => {
    if (isBusy) return;
    busy(true);
    showStatus("drmRestoring");
    try {
      showDevice(await restoreBundledDevice());
      field("device").value = "";
      showSelection();
      showStatus("drmRestored", "success");
    } catch {
      showStatus("drmRestoreFailed", "error");
    } finally {
      busy(false);
    }
  });
  var namingFields = {
    defaultFolder: field("defaultFolder"),
    outputTemplate: field("outputTemplate"),
    saveMode: field("saveMode"),
    embyEnabled: field("embyEnabled"),
    embyMediaType: field("embyMediaType"),
    embyNfo: field("embyNfo"),
    embyImages: field("embyImages")
  };
  var SAMPLE_TASK = {
    title: "\u793A\u4F8B\u89C6\u9891\u6807\u9898",
    videoId: "abc123",
    channel: "\u793A\u4F8B\u9891\u9053",
    channelId: "UC123456",
    resolution: "1920x1080",
    width: 1920,
    height: 1080,
    duration: 3723,
    createdAt: Date.UTC(2026, 6, 12, 10, 30, 0),
    releaseDate: null
  };
  function readNamingForm() {
    return {
      defaultFolder: namingFields.defaultFolder.value,
      outputTemplate: namingFields.outputTemplate.value,
      saveMode: namingFields.saveMode.value,
      embyEnabled: namingFields.embyEnabled.checked,
      embyMediaType: namingFields.embyMediaType.value,
      embyNfo: namingFields.embyNfo.checked,
      embyImages: namingFields.embyImages.checked
    };
  }
  function syncEmbyControls() {
    const enabled = namingFields.embyEnabled.checked;
    namingFields.embyMediaType.disabled = !enabled;
    namingFields.embyNfo.disabled = !enabled;
    namingFields.embyImages.disabled = !enabled;
  }
  function updatePreview() {
    const settings = normalizeSettings(readNamingForm());
    field("templatePreview").textContent = buildDownloadPath(SAMPLE_TASK, "mp4", settings).path;
  }
  function writeNamingForm(values) {
    namingFields.defaultFolder.value = values.defaultFolder;
    namingFields.outputTemplate.value = values.outputTemplate;
    namingFields.saveMode.value = values.saveMode;
    namingFields.embyEnabled.checked = values.embyEnabled;
    namingFields.embyMediaType.value = values.embyMediaType;
    namingFields.embyNfo.checked = values.embyNfo;
    namingFields.embyImages.checked = values.embyImages;
    syncEmbyControls();
    updatePreview();
  }
  function showNamingStatus() {
    field("namingStatus").textContent = message("namingSaved");
    setTimeout(() => {
      field("namingStatus").textContent = "";
    }, 2e3);
  }
  var namingSaveTimer;
  function scheduleNamingSave() {
    updatePreview();
    syncEmbyControls();
    clearTimeout(namingSaveTimer);
    namingSaveTimer = setTimeout(async () => {
      await saveSettings(readNamingForm()).catch(() => {
      });
      showNamingStatus();
    }, 300);
  }
  for (const element of Object.values(namingFields)) {
    element.addEventListener("input", scheduleNamingSave);
    element.addEventListener("change", scheduleNamingSave);
  }
  field("resetNaming").addEventListener("click", async () => {
    writeNamingForm(DEFAULT_SETTINGS);
    await saveSettings(DEFAULT_SETTINGS).catch(() => {
    });
    showNamingStatus();
  });
  loadSettings().then(writeNamingForm).catch(() => writeNamingForm({ ...DEFAULT_SETTINGS }));
  async function renderDirectoryState() {
    const state = field("directoryState");
    const handle = await loadDirectoryHandle();
    if (!handle) {
      state.dataset.state = "";
      state.textContent = message("namingDirectoryNone");
      return;
    }
    const permission = await directoryPermission(handle);
    if (permission === "granted") {
      state.dataset.state = "ready";
      state.textContent = message("namingDirectorySelected", [handle.name]);
    } else {
      state.dataset.state = "";
      state.textContent = message("namingDirectoryPermission", [handle.name]);
    }
  }
  field("pickDirectory").addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      field("namingStatus").textContent = message("namingDirectoryUnsupported");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: "rplay-output", mode: "readwrite" });
      await directoryPermission(handle, { request: true });
      await saveDirectoryHandle(handle);
      await saveSettings({ useCustomDirectory: true });
      await renderDirectoryState();
      showNamingStatus();
    } catch {
    }
  });
  field("clearDirectory").addEventListener("click", async () => {
    await clearDirectoryHandle().catch(() => {
    });
    await saveSettings({ useCustomDirectory: false }).catch(() => {
    });
    await renderDirectoryState();
  });
  renderDirectoryState().catch(() => {
  });
})();
