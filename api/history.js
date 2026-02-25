const { del, list, put } = require("@vercel/blob");

const MAX_HISTORY_ITEMS = 2;
const HISTORY_PREFIX = "history/";
const META_PREFIX = `${HISTORY_PREFIX}meta-`;
const FIT_PREFIX = `${HISTORY_PREFIX}fit-`;

module.exports = async function handler(req, res) {
  try {
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
  const id = readQueryParam(req.query, "id");
  if (id) {
    const entry = await getEntryById(id);
    if (!entry) {
      throw httpError(404, "Záznam nebyl nalezen.");
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
    access: "public",
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
    fileUrl: fitBlob.url,
  };

  const metaPathname = `${META_PREFIX}${id}.json`;
  await put(metaPathname, JSON.stringify(entry), {
    access: "public",
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
  return entries.filter(Boolean);
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
  const response = await fetch(blob.url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  const raw = await response.json();
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const fallbackId = extractIdFromPath(blob.pathname);
  if (!raw.id && fallbackId) {
    raw.id = fallbackId;
  }

  return normalizeHistoryEntry(raw);
}

async function pruneHistoryToMax(maxItems) {
  const metaBlobs = await listMetaBlobs();
  const staleBlobs = metaBlobs.slice(maxItems);

  for (const staleMetaBlob of staleBlobs) {
    const staleEntry = await fetchEntryFromMetaBlob(staleMetaBlob);
    const targets = [staleMetaBlob.url];

    if (staleEntry && typeof staleEntry.fileUrl === "string" && staleEntry.fileUrl.length > 0) {
      targets.push(staleEntry.fileUrl);
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

  if (!fileUrl) {
    return null;
  }

  return {
    id,
    fileName,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    totalDistanceM: Number.isFinite(totalDistanceM) ? totalDistanceM : null,
    totalAscentM: Number.isFinite(totalAscentM) ? totalAscentM : null,
    avgSpeedKmh: Number.isFinite(avgSpeedKmh) ? avgSpeedKmh : null,
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
  if (req.body && typeof req.body === "object") {
    return req.body;
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
