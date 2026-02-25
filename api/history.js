const { del, list, put } = require("@vercel/blob");

const MAX_HISTORY_ITEMS = 2;
const HISTORY_PREFIX = "default/history/";
const META_PREFIX = `${HISTORY_PREFIX}meta-`;
const FIT_PREFIX = `${HISTORY_PREFIX}fit-`;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_ACCESS = "public";

module.exports = async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      await handleGet(req, res);
      return;
    }

    if (req.method === "POST") {
      await handlePost(req, res);
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Metoda není podporovaná." });
  } catch (error) {
    sendError(res, error);
  }
};

async function handleGet(req, res) {
  const diag = readQueryParam(req.query, "diag");
  if (diag === "1" || diag === "true") {
    const metaBlobs = await listMetaBlobs();
    const diagWrite = readQueryParam(req.query, "diagWrite");
    let writeCheck = null;
    if (diagWrite === "1" || diagWrite === "true") {
      writeCheck = await runWriteDiagnostic();
    }

    res.status(200).json({
      ok: true,
      tokenPresent: Boolean(BLOB_TOKEN),
      historyPrefix: HISTORY_PREFIX,
      metaCount: metaBlobs.length,
      sampleMetaPathnames: metaBlobs.slice(0, 5).map((item) => item.pathname),
      writeCheck,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const id = readQueryParam(req.query, "id");
  if (id) {
    const entry = await getEntryById(id);
    if (!entry) {
      throw httpError(404, "Záznam nebyl nalezen.");
    }

    const includeFile = readQueryParam(req.query, "includeFile");
    if (includeFile === "1" || includeFile === "true") {
      const fileBase64 = await getEntryFileBase64(entry);
      if (!fileBase64) {
        throw httpError(404, "FIT soubor v historii nebyl nalezen.");
      }
      res.status(200).json({ entry, fileBase64 });
      return;
    }

    res.status(200).json({ entry });
    return;
  }

  const rawLimit = readQueryParam(req.query, "limit");
  const parsedLimit = Number.parseInt(rawLimit || "", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_HISTORY_ITEMS)
    : MAX_HISTORY_ITEMS;

  const entries = await getLatestEntries(limit);
  res.status(200).json({ entries });
}

async function handlePost(req, res) {
  const body = await readJsonBody(req);
  const fileName = typeof body.fileName === "string" ? body.fileName : "ride.fit";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";

  if (!fileBase64) {
    throw httpError(400, "Chybí obsah FIT souboru.");
  }

  let fileBuffer = null;
  try {
    fileBuffer = Buffer.from(fileBase64, "base64");
  } catch (_error) {
    throw httpError(400, "Obsah FIT souboru není validní base64.");
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw httpError(400, "FIT soubor je prázdný.");
  }

  const id = createHistoryId();
  const safeName = sanitizeFileName(fileName);
  const fitPathname = `${FIT_PREFIX}${id}-${safeName}`;
  const fitBlob = await put(fitPathname, fileBuffer, {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: mimeType,
  });

  const createdAtMs = Number(body.createdAtMs);
  const totalDistanceM = Number(body.totalDistanceM);
  const totalAscentM = Number(body.totalAscentM);
  const avgSpeedKmh = Number(body.avgSpeedKmh);

  const entry = {
    id,
    fileName,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    totalDistanceM: Number.isFinite(totalDistanceM) ? totalDistanceM : null,
    totalAscentM: Number.isFinite(totalAscentM) ? totalAscentM : null,
    avgSpeedKmh: Number.isFinite(avgSpeedKmh) ? avgSpeedKmh : null,
    filePathname: fitPathname,
    fileUrl: getBlobReadUrl(fitBlob),
  };

  const metaPathname = `${META_PREFIX}${id}.json`;
  await put(metaPathname, JSON.stringify(entry), {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });

  await pruneHistoryToMax(MAX_HISTORY_ITEMS);
  res.status(201).json({ entry });
}

async function getLatestEntries(limit) {
  const metaBlobs = await listMetaBlobs();
  const selected = metaBlobs.slice(0, limit);
  const entries = await Promise.all(selected.map((blob) => fetchEntryFromMetaBlob(blob)));
  const normalized = entries.filter(Boolean);
  if (normalized.length > 0) {
    return normalized;
  }

  // Fallback: if metadata files exist but cannot be fetched, still return placeholders.
  return selected.map((blob) => {
    const id = extractIdFromPath(blob.pathname) || `unknown-${Date.now()}`;
    return {
      id,
      fileName: `Jízda #${id}`,
      createdAtMs: Number.isFinite(Date.parse(blob.uploadedAt || "")) ? Date.parse(blob.uploadedAt) : Date.now(),
      totalDistanceM: null,
      totalAscentM: null,
      avgSpeedKmh: null,
      filePathname: null,
      fileUrl: null,
    };
  });
}

async function getEntryById(id) {
  const expectedPathname = `${META_PREFIX}${id}.json`;
  const response = await list({ prefix: expectedPathname });
  const exactMatch = response.blobs.find((blob) => blob.pathname === expectedPathname);
  if (!exactMatch) {
    return null;
  }
  return fetchEntryFromMetaBlob(exactMatch);
}

async function listMetaBlobs() {
  const response = await list({ prefix: META_PREFIX });
  return [...response.blobs].sort((a, b) => {
    const aTime = Date.parse(a.uploadedAt || 0);
    const bTime = Date.parse(b.uploadedAt || 0);
    return bTime - aTime;
  });
}

async function fetchEntryFromMetaBlob(blob) {
  const metaReadUrl = getBlobReadUrl(blob);
  if (!metaReadUrl) {
    return null;
  }

  const raw = await fetchBlobJson(metaReadUrl);
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const fallbackId = extractIdFromPath(blob.pathname);
  if (!raw.id && fallbackId) {
    raw.id = fallbackId;
  }

  if (typeof raw.filePathname === "string" && raw.filePathname.length > 0) {
    raw.fileUrl = await resolveBlobReadUrl(raw.filePathname);
  } else if (!raw.fileUrl && typeof raw.filePath === "string" && raw.filePath.length > 0) {
    raw.filePathname = raw.filePath;
    raw.fileUrl = await resolveBlobReadUrl(raw.filePathname);
  }

  return normalizeHistoryEntry(raw);
}

async function pruneHistoryToMax(maxItems) {
  const metaBlobs = await listMetaBlobs();
  const staleBlobs = metaBlobs.slice(maxItems);

  for (const staleMetaBlob of staleBlobs) {
    const staleEntry = await fetchEntryFromMetaBlob(staleMetaBlob);
    const targets = [staleMetaBlob.pathname];

    if (
      staleEntry &&
      typeof staleEntry.filePathname === "string" &&
      staleEntry.filePathname.length > 0
    ) {
      targets.push(staleEntry.filePathname);
    }

    const uniqueTargets = [...new Set(targets)];
    await del(uniqueTargets);
  }
}

function normalizeHistoryEntry(entry) {
  const id = normalizeId(entry.id);
  if (!id) {
    return null;
  }

  const createdAtMs = Number(entry.createdAtMs);
  const totalDistanceM = Number(entry.totalDistanceM);
  const totalAscentM = Number(entry.totalAscentM);
  const avgSpeedKmh = Number(entry.avgSpeedKmh);
  const fileUrl = typeof entry.fileUrl === "string" ? entry.fileUrl : null;
  const fileName =
    typeof entry.fileName === "string" && entry.fileName.length > 0
      ? entry.fileName
      : `Jízda #${id}`;

  const filePathname =
    typeof entry.filePathname === "string" && entry.filePathname.length > 0
      ? entry.filePathname
      : null;

  if (!fileUrl && !filePathname) {
    return null;
  }

  return {
    id,
    fileName,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    totalDistanceM: Number.isFinite(totalDistanceM) ? totalDistanceM : null,
    totalAscentM: Number.isFinite(totalAscentM) ? totalAscentM : null,
    avgSpeedKmh: Number.isFinite(avgSpeedKmh) ? avgSpeedKmh : null,
    filePathname,
    fileUrl,
  };
}

function extractIdFromPath(pathname) {
  const match = String(pathname).match(/meta-(.+)\.json$/);
  return match ? match[1] : null;
}

function normalizeId(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

function createHistoryId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${random}`;
}

async function resolveBlobReadUrl(pathname) {
  try {
    const response = await list({ prefix: pathname });
    const exactMatch = response.blobs.find((blob) => blob.pathname === pathname);
    return getBlobReadUrl(exactMatch);
  } catch (_error) {
    return null;
  }
}

async function getEntryFileBase64(entry) {
  const readUrl = await resolveEntryReadUrl(entry);
  if (!readUrl) {
    return null;
  }

  const arrayBuffer = await fetchBlobArrayBuffer(readUrl);
  if (!arrayBuffer) {
    return null;
  }
  return Buffer.from(arrayBuffer).toString("base64");
}

async function resolveEntryReadUrl(entry) {
  if (typeof entry.filePathname === "string" && entry.filePathname.length > 0) {
    const urlFromPath = await resolveBlobReadUrl(entry.filePathname);
    if (urlFromPath) {
      return urlFromPath;
    }
  }

  if (typeof entry.fileUrl === "string" && entry.fileUrl.length > 0) {
    return entry.fileUrl;
  }

  return null;
}

function getBlobReadUrl(blobInfo) {
  if (!blobInfo || typeof blobInfo !== "object") {
    return null;
  }
  if (typeof blobInfo.downloadUrl === "string" && blobInfo.downloadUrl.length > 0) {
    return blobInfo.downloadUrl;
  }
  if (typeof blobInfo.url === "string" && blobInfo.url.length > 0) {
    return blobInfo.url;
  }
  return null;
}

function getBlobFetchHeaders() {
  if (!BLOB_TOKEN) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${BLOB_TOKEN}`,
  };
}

async function fetchBlobJson(url) {
  const withAuth = await fetchWithOptionalAuth(url, true);
  if (withAuth?.ok) {
    try {
      return await withAuth.response.json();
    } catch (_error) {
      return null;
    }
  }

  const withoutAuth = await fetchWithOptionalAuth(url, false);
  if (withoutAuth?.ok) {
    try {
      return await withoutAuth.response.json();
    } catch (_error) {
      return null;
    }
  }

  return null;
}

async function fetchBlobArrayBuffer(url) {
  const withAuth = await fetchWithOptionalAuth(url, true);
  if (withAuth?.ok) {
    return withAuth.response.arrayBuffer();
  }

  const withoutAuth = await fetchWithOptionalAuth(url, false);
  if (withoutAuth?.ok) {
    return withoutAuth.response.arrayBuffer();
  }

  return null;
}

async function fetchWithOptionalAuth(url, useAuthHeader) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: useAuthHeader ? getBlobFetchHeaders() : undefined,
    });
    return { ok: response.ok, response };
  } catch (_error) {
    return { ok: false, response: null };
  }
}

async function runWriteDiagnostic() {
  const probeId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const probePath = `${HISTORY_PREFIX}${probeId}.txt`;

  try {
    await put(probePath, "ok", {
      access: BLOB_ACCESS,
      addRandomSuffix: false,
      contentType: "text/plain; charset=utf-8",
    });

    const listed = await list({ prefix: probePath });
    const exists = listed.blobs.some((blob) => blob.pathname === probePath);
    await del([probePath]);
    return { ok: true, probePath, existsAfterPut: exists };
  } catch (error) {
    return {
      ok: false,
      probePath,
      message: error?.message || "Neznámá chyba write diagnostiky.",
    };
  }
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "ride.fit")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  return cleaned || "ride.fit";
}

function readQueryParam(query, key) {
  const value = query ? query[key] : undefined;
  if (Array.isArray(value)) {
    return value[0] ? String(value[0]).trim() : "";
  }
  return value ? String(value).trim() : "";
}

async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) {
    const rawBuffer = req.body.toString("utf8");
    if (!rawBuffer) {
      return {};
    }
    try {
      return JSON.parse(rawBuffer);
    } catch (_error) {
      throw httpError(400, "Tělo požadavku není validní JSON.");
    }
  }

  if (ArrayBuffer.isView(req.body)) {
    const viewBuffer = Buffer.from(req.body.buffer, req.body.byteOffset, req.body.byteLength);
    const rawView = viewBuffer.toString("utf8");
    if (!rawView) {
      return {};
    }
    try {
      return JSON.parse(rawView);
    } catch (_error) {
      throw httpError(400, "Tělo požadavku není validní JSON.");
    }
  }

  if (req.body instanceof ArrayBuffer) {
    const rawArrayBuffer = Buffer.from(req.body).toString("utf8");
    if (!rawArrayBuffer) {
      return {};
    }
    try {
      return JSON.parse(rawArrayBuffer);
    } catch (_error) {
      throw httpError(400, "Tělo požadavku není validní JSON.");
    }
  }

  if (req.body && typeof req.body === "object") {
    return req.body || {};
  }

  if (typeof req.body === "string" && req.body.length > 0) {
    try {
      return JSON.parse(req.body);
    } catch (_error) {
      throw httpError(400, "Tělo požadavku není validní JSON.");
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    throw httpError(400, "Tělo požadavku není validní JSON.");
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendError(res, error) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const message = error.message || "Neočekávaná chyba serveru.";
  if (statusCode >= 500) {
    console.error(error);
  }
  res.status(statusCode).json({ error: message });
}
