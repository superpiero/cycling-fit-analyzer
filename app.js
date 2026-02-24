const TARGET_DISTANCE_M = 100_000;
const TARGET_ASCENT_M = 1_609;
const SEMICIRCLES_TO_DEGREES = 180 / 2_147_483_648;

const fitFileInput = document.getElementById("fitFile");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

const distanceTotalEl = document.getElementById("distanceTotal");
const avgSpeedEl = document.getElementById("avgSpeed");
const totalAscentEl = document.getElementById("totalAscent");

const segment100SummaryEl = document.getElementById("segment100Summary");
const segment1609SummaryEl = document.getElementById("segment1609Summary");
const download100Btn = document.getElementById("download100Btn");
const download1609Btn = document.getElementById("download1609Btn");

const mapFullEl = document.getElementById("mapFull");
const map100El = document.getElementById("map100");
const map1609El = document.getElementById("map1609");
const mapFullNoteEl = document.getElementById("mapFullNote");
const map100NoteEl = document.getElementById("map100Note");
const map1609NoteEl = document.getElementById("map1609Note");

const MAP_DEFAULT_CENTER = [50.0755, 14.4378];
const mapState = {
  full: {
    key: "full",
    element: mapFullEl,
    map: null,
    overlays: [],
    lastBounds: null,
    lastPadding: 20,
    lastZoomDelta: 0,
  },
  km100: {
    key: "km100",
    element: map100El,
    map: null,
    overlays: [],
    lastBounds: null,
    lastPadding: 20,
    lastZoomDelta: 0,
  },
  m1609: {
    key: "m1609",
    element: map1609El,
    map: null,
    overlays: [],
    lastBounds: null,
    lastPadding: 20,
    lastZoomDelta: 0,
  },
};

let lastRun = null;

window.addEventListener("resize", () => {
  if (!lastRun) {
    return;
  }
  requestAnimationFrame(() => {
    for (const state of Object.values(mapState)) {
      if (!state.map) {
        continue;
      }
      state.map.invalidateSize();
      if (state.lastBounds) {
        state.map.fitBounds(state.lastBounds, {
          padding: [state.lastPadding, state.lastPadding],
          animate: false,
        });
        applyZoomDelta(state.map, state.lastZoomDelta);
      }
    }
  });
});

fitFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  statusEl.textContent = "Zpracovavam FIT soubor...";
  resultsEl.classList.add("hidden");
  download100Btn.classList.add("hidden");
  download1609Btn.classList.add("hidden");

  try {
    const buffer = await file.arrayBuffer();
    const parsedFit = parseFitFile(buffer);
    const analysis = analyzeRide(parsedFit);

    lastRun = {
      fileName: file.name,
      parsedFit,
      analysis,
    };

    resultsEl.classList.remove("hidden");
    renderAnalysis(lastRun);

    statusEl.textContent = "Hotovo. Vypocet byl uspesne dokonceny.";
  } catch (error) {
    statusEl.textContent = `Nepodarilo se nacist soubor: ${error.message}`;
    lastRun = null;
    console.error(error);
  }
});

download100Btn.addEventListener("click", () => {
  if (!lastRun?.analysis.fastest100) {
    return;
  }

  const segment = lastRun.analysis.fastest100.exportWindow;
  const trimmedBuffer = buildTrimmedFit(
    lastRun.parsedFit,
    segment.startRecordOrdinal,
    segment.endRecordOrdinal
  );

  const baseName = lastRun.fileName.replace(/\.fit$/i, "");
  const downloadName = `${baseName}_fastest_100km.fit`;
  downloadBinary(trimmedBuffer, downloadName);
});

download1609Btn.addEventListener("click", () => {
  if (!lastRun?.analysis.fastest1609) {
    return;
  }

  const segment = lastRun.analysis.fastest1609.exportWindow;
  const trimmedBuffer = buildTrimmedFit(
    lastRun.parsedFit,
    segment.startRecordOrdinal,
    segment.endRecordOrdinal
  );

  const baseName = lastRun.fileName.replace(/\.fit$/i, "");
  const downloadName = `${baseName}_fastest_1609m.fit`;
  downloadBinary(trimmedBuffer, downloadName);
});

function renderAnalysis(run) {
  const { analysis, parsedFit } = run;
  distanceTotalEl.textContent = formatDistance(analysis.totalDistanceM);
  avgSpeedEl.textContent = formatSpeed(analysis.avgSpeedKmh);
  totalAscentEl.textContent = formatAscent(analysis.totalAscentM);

  if (analysis.fastest100) {
    segment100SummaryEl.textContent =
      `Cas: ${formatDuration(analysis.fastest100.elapsedSec)} | ` +
      `Prumerna rychlost: ${formatSpeed(analysis.fastest100.avgSpeedKmh)}`;
    download100Btn.classList.remove("hidden");
  } else {
    segment100SummaryEl.textContent =
      "Vyjizdka nema 100 km, nejrychlejsi usek nelze vypocitat.";
    download100Btn.classList.add("hidden");
  }

  if (analysis.fastest1609) {
    segment1609SummaryEl.textContent =
      `Cas: ${formatDuration(analysis.fastest1609.elapsedSec)} | ` +
      `Ujeta vzdalenost: ${formatDistance(analysis.fastest1609.distanceCoveredM)} | ` +
      `Prumerna rychlost: ${formatSpeed(analysis.fastest1609.avgSpeedKmh)}`;
    download1609Btn.classList.remove("hidden");
  } else {
    segment1609SummaryEl.textContent =
      "Vyjizdka nema nastoupanych 1609 m, tento usek nelze vypocitat.";
    download1609Btn.classList.add("hidden");
  }

  renderMaps(parsedFit, analysis);
}

function analyzeRide(parsedFit) {
  const samples = buildSamples(parsedFit.records);
  if (samples.length < 2) {
    throw new Error("V souboru nejsou pouzitelna record data.");
  }

  const first = samples[0];
  const last = samples[samples.length - 1];

  const totalDistanceM = Math.max(0, last.distanceM - first.distanceM);
  const elapsedSec = Math.max(0, last.timestamp - first.timestamp);
  const totalAscentM = Math.max(0, last.cumulativeAscentM - first.cumulativeAscentM);
  const avgSpeedKmh = elapsedSec > 0 ? (totalDistanceM / elapsedSec) * 3.6 : 0;

  const distanceMetric = samples.map((s) => s.distanceM);
  const ascentMetric = samples.map((s) => s.cumulativeAscentM);
  const timestamps = samples.map((s) => s.timestamp);

  const fastest100Window =
    totalDistanceM >= TARGET_DISTANCE_M
      ? findFastestWindow(distanceMetric, timestamps, TARGET_DISTANCE_M)
      : null;

  const fastest100 = fastest100Window
    ? {
        elapsedSec: fastest100Window.elapsedSec,
        avgSpeedKmh: (TARGET_DISTANCE_M / fastest100Window.elapsedSec) * 3.6,
        exportWindow: {
          startRecordOrdinal: samples[fastest100Window.startIndex].recordOrdinal,
          endRecordOrdinal: samples[fastest100Window.endIndex].recordOrdinal,
        },
      }
    : null;

  const fastest1609Window =
    totalAscentM >= TARGET_ASCENT_M
      ? findFastestWindow(ascentMetric, timestamps, TARGET_ASCENT_M)
      : null;

  let fastest1609 = null;
  if (fastest1609Window) {
    const distanceCoveredM = interpolateCoveredMetric(
      samples.map((s) => s.distanceM),
      fastest1609Window
    );
    fastest1609 = {
      elapsedSec: fastest1609Window.elapsedSec,
      distanceCoveredM,
      avgSpeedKmh:
        fastest1609Window.elapsedSec > 0
          ? (distanceCoveredM / fastest1609Window.elapsedSec) * 3.6
          : 0,
      exportWindow: {
        startRecordOrdinal: samples[fastest1609Window.startIndex].recordOrdinal,
        endRecordOrdinal: samples[fastest1609Window.endIndex].recordOrdinal,
      },
    };
  }

  return {
    totalDistanceM,
    totalAscentM,
    avgSpeedKmh,
    fastest100,
    fastest1609,
  };
}

function buildSamples(records) {
  const samples = [];
  let prevDistance = null;
  let prevAltitude = null;
  let cumulativeAscentM = 0;

  for (const record of records) {
    if (!Number.isFinite(record.timestamp) || !Number.isFinite(record.distanceM)) {
      continue;
    }

    let distanceM = record.distanceM;
    if (prevDistance !== null && distanceM < prevDistance) {
      distanceM = prevDistance;
    }

    if (Number.isFinite(record.altitudeM) && Number.isFinite(prevAltitude)) {
      const gain = record.altitudeM - prevAltitude;
      if (gain > 0) {
        cumulativeAscentM += gain;
      }
    }

    if (Number.isFinite(record.altitudeM)) {
      prevAltitude = record.altitudeM;
    }

    samples.push({
      recordOrdinal: record.recordOrdinal,
      timestamp: record.timestamp,
      distanceM,
      cumulativeAscentM,
    });

    prevDistance = distanceM;
  }

  return samples;
}

function findFastestWindow(metric, timestamps, target) {
  if (metric.length !== timestamps.length || metric.length < 2) {
    return null;
  }

  let best = null;
  let right = 0;

  for (let left = 0; left < metric.length; left += 1) {
    if (right < left) {
      right = left;
    }

    while (right < metric.length && metric[right] - metric[left] < target) {
      right += 1;
    }

    if (right >= metric.length) {
      break;
    }

    let endPrevIndex = right;
    let endIndex = right;
    let endRatio = 0;
    let endTimestamp = timestamps[right];

    if (metric[right] - metric[left] > target) {
      endPrevIndex = Math.max(left, right - 1);
      const previousGain = metric[endPrevIndex] - metric[left];
      const currentGain = metric[right] - metric[left];
      const denominator = currentGain - previousGain;
      if (denominator <= 0) {
        continue;
      }
      endRatio = (target - previousGain) / denominator;
      endTimestamp =
        timestamps[endPrevIndex] +
        endRatio * (timestamps[right] - timestamps[endPrevIndex]);
    }

    const elapsedSec = endTimestamp - timestamps[left];
    if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) {
      continue;
    }

    if (!best || elapsedSec < best.elapsedSec) {
      best = {
        startIndex: left,
        endPrevIndex,
        endIndex,
        endRatio,
        elapsedSec,
      };
    }
  }

  return best;
}

function interpolateCoveredMetric(metric, window) {
  const start = metric[window.startIndex];

  let end = metric[window.endIndex];
  if (window.endIndex !== window.endPrevIndex) {
    const from = metric[window.endPrevIndex];
    const to = metric[window.endIndex];
    end = from + window.endRatio * (to - from);
  }

  return Math.max(0, end - start);
}

function renderMaps(parsedFit, analysis) {
  const fullTrack = extractTrackPoints(parsedFit.records);
  const fullLatLngs = toLatLngs(fullTrack);
  const hasMapLibrary = typeof window.L !== "undefined";

  mapFullNoteEl.textContent = fullTrack.length
    ? `${fullTrack.length} GPS bodu`
    : "V tomto FIT souboru nejsou GPS souradnice.";

  if (!hasMapLibrary) {
    mapFullNoteEl.textContent += " | Mapovy podklad se nepodarilo nacist.";
    map100NoteEl.textContent = "Mapovy podklad se nepodarilo nacist.";
    map1609NoteEl.textContent = "Mapovy podklad se nepodarilo nacist.";
    return;
  }

  drawContextAndSegment(mapState.full, {
    contextLatLngs: [],
    segmentLatLngs: fullLatLngs,
    segmentColor: "#1c7c61",
    boundsLatLngs: fullLatLngs,
    padding: 14,
    zoomDelta: 1,
  });

  if (analysis.fastest100) {
    const range = analysis.fastest100.exportWindow;
    const points100 = extractTrackPoints(
      parsedFit.records,
      range.startRecordOrdinal,
      range.endRecordOrdinal
    );
    const segment100LatLngs = toLatLngs(points100);
    drawContextAndSegment(mapState.km100, {
      contextLatLngs: fullLatLngs,
      segmentLatLngs: segment100LatLngs,
      segmentColor: "#da5a2a",
      boundsLatLngs: segment100LatLngs.length >= 2 ? segment100LatLngs : fullLatLngs,
      padding: 14,
      zoomDelta: 1,
    });
    map100NoteEl.textContent = segment100LatLngs.length >= 2
      ? `${formatDuration(analysis.fastest100.elapsedSec)} | ${formatSpeed(analysis.fastest100.avgSpeedKmh)}`
      : "Segment je vypocitany, ale chybi mu GPS body.";
  } else {
    drawContextAndSegment(mapState.km100, {
      contextLatLngs: fullLatLngs,
      segmentLatLngs: [],
      segmentColor: "#da5a2a",
      boundsLatLngs: fullLatLngs,
      padding: 14,
      zoomDelta: 1,
    });
    map100NoteEl.textContent = "Segment 100 km neni k dispozici.";
  }

  if (analysis.fastest1609) {
    const range = analysis.fastest1609.exportWindow;
    const points1609 = extractTrackPoints(
      parsedFit.records,
      range.startRecordOrdinal,
      range.endRecordOrdinal
    );
    const segment1609LatLngs = toLatLngs(points1609);
    drawContextAndSegment(mapState.m1609, {
      contextLatLngs: fullLatLngs,
      segmentLatLngs: segment1609LatLngs,
      segmentColor: "#2a5fda",
      boundsLatLngs: segment1609LatLngs.length >= 2 ? segment1609LatLngs : fullLatLngs,
      padding: 14,
      zoomDelta: 1,
    });
    map1609NoteEl.textContent = segment1609LatLngs.length >= 2
      ? `${formatDuration(analysis.fastest1609.elapsedSec)} | ${formatSpeed(analysis.fastest1609.avgSpeedKmh)}`
      : "Segment je vypocitany, ale chybi mu GPS body.";
  } else {
    drawContextAndSegment(mapState.m1609, {
      contextLatLngs: fullLatLngs,
      segmentLatLngs: [],
      segmentColor: "#2a5fda",
      boundsLatLngs: fullLatLngs,
      padding: 14,
      zoomDelta: 1,
    });
    map1609NoteEl.textContent = "Segment 1609 m neni k dispozici.";
  }
}

function extractTrackPoints(records, startRecordOrdinal = null, endRecordOrdinal = null) {
  const points = [];

  for (const record of records) {
    if (
      Number.isInteger(startRecordOrdinal) &&
      Number.isInteger(endRecordOrdinal) &&
      (record.recordOrdinal < startRecordOrdinal || record.recordOrdinal > endRecordOrdinal)
    ) {
      continue;
    }

    if (!Number.isFinite(record.latDeg) || !Number.isFinite(record.lonDeg)) {
      continue;
    }

    points.push({
      lat: record.latDeg,
      lon: record.lonDeg,
    });
  }

  return points;
}

function toLatLngs(points) {
  return points.map((point) => [point.lat, point.lon]);
}

function ensureLeafletMap(state) {
  if (state.map) {
    return state.map;
  }
  if (!state.element || typeof window.L === "undefined") {
    return null;
  }

  const map = window.L.map(state.element, {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    tap: false,
    attributionControl: true,
    preferCanvas: true,
  });

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  map.setView(MAP_DEFAULT_CENTER, 7);
  state.map = map;
  return map;
}

function clearOverlayLayers(state) {
  if (!state.map) {
    return;
  }
  for (const layer of state.overlays) {
    state.map.removeLayer(layer);
  }
  state.overlays = [];
}

function drawContextAndSegment(state, payload) {
  const map = ensureLeafletMap(state);
  if (!map) {
    return;
  }

  clearOverlayLayers(state);

  const {
    contextLatLngs,
    segmentLatLngs,
    segmentColor,
    boundsLatLngs,
    padding = 20,
    zoomDelta = 0,
  } = payload;

  if (contextLatLngs.length >= 2) {
    const contextLayer = window.L.polyline(contextLatLngs, {
      color: "#4f5b52",
      weight: 2.5,
      opacity: 0.35,
    }).addTo(map);
    state.overlays.push(contextLayer);
  }

  if (segmentLatLngs.length >= 2) {
    const segmentLayer = window.L.polyline(segmentLatLngs, {
      color: segmentColor,
      weight: 4.5,
      opacity: 0.95,
    }).addTo(map);
    state.overlays.push(segmentLayer);
    addSegmentEndpoints(map, state, segmentLatLngs, segmentColor);
  }

  const bounds = buildBoundsFromLatLngs(boundsLatLngs);
  if (bounds) {
    map.fitBounds(bounds, { padding: [padding, padding], animate: false });
    applyZoomDelta(map, zoomDelta);
    state.lastBounds = bounds;
    state.lastPadding = padding;
    state.lastZoomDelta = zoomDelta;
  } else {
    map.setView(MAP_DEFAULT_CENTER, 7);
    state.lastBounds = null;
    state.lastPadding = 20;
    state.lastZoomDelta = 0;
  }

  map.invalidateSize();
}

function applyZoomDelta(map, zoomDelta) {
  if (!Number.isFinite(zoomDelta) || zoomDelta === 0) {
    return;
  }
  const targetZoom = Math.min(18, map.getZoom() + zoomDelta);
  map.setZoom(targetZoom, { animate: false });
}

function addSegmentEndpoints(map, state, segmentLatLngs, segmentColor) {
  const start = segmentLatLngs[0];
  const end = segmentLatLngs[segmentLatLngs.length - 1];

  const startMarker = window.L.circleMarker(start, {
    radius: 4,
    color: segmentColor,
    weight: 2,
    fillColor: "#ffffff",
    fillOpacity: 1,
    interactive: false,
  }).addTo(map);

  const endMarker = window.L.circleMarker(end, {
    radius: 4,
    color: segmentColor,
    weight: 2,
    fillColor: segmentColor,
    fillOpacity: 1,
    interactive: false,
  }).addTo(map);

  state.overlays.push(startMarker, endMarker);
}

function buildBoundsFromLatLngs(latLngs) {
  if (!latLngs || latLngs.length < 2 || typeof window.L === "undefined") {
    return null;
  }
  return window.L.latLngBounds(latLngs);
}

function parseFitFile(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 14) {
    throw new Error("Soubor je prilis kratky na FIT format.");
  }

  const headerSize = bytes[0];
  if (headerSize < 12 || bytes.length < headerSize) {
    throw new Error("Neplatna FIT hlavicka.");
  }

  const dataType = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (dataType !== ".FIT") {
    throw new Error("Soubor nema FIT podpis.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const protocolVersion = bytes[1];
  const profileVersion = view.getUint16(2, true);
  const dataSize = view.getUint32(4, true);
  const dataStart = headerSize;
  const dataEnd = dataStart + dataSize;

  if (dataEnd > bytes.length) {
    throw new Error("FIT hlavicka ukazuje mimo data souboru.");
  }

  const definitions = new Map();
  const messages = [];
  const records = [];

  let position = dataStart;
  let lastTimestamp = null;
  let recordOrdinalCounter = 0;

  while (position < dataEnd) {
    const messageStart = position;
    const header = bytes[position];
    position += 1;

    if ((header & 0x80) !== 0) {
      const localMesgNum = (header >> 5) & 0x03;
      const timeOffset = header & 0x1f;
      const definition = definitions.get(localMesgNum);
      if (!definition) {
        throw new Error(`Chybi definice pro local message ${localMesgNum}.`);
      }

      const payloadStart = position;
      const payloadEnd = payloadStart + definition.dataSize;
      if (payloadEnd > dataEnd) {
        throw new Error("Data message presahuje konec FIT dat.");
      }

      const parsedFields = decodeDataFields(view, payloadStart, definition);
      position = payloadEnd;

      let timestamp = parsedFields.get(253);
      if (!Number.isFinite(timestamp) && Number.isFinite(lastTimestamp)) {
        timestamp = expandCompressedTimestamp(lastTimestamp, timeOffset);
      }
      if (Number.isFinite(timestamp)) {
        lastTimestamp = timestamp;
      } else {
        timestamp = null;
      }

      const message = {
        raw: bytes.slice(messageStart, payloadEnd),
        isDefinition: false,
        isData: true,
        localMesgNum,
        globalMesgNum: definition.globalMesgNum,
        timestamp,
        recordOrdinal: null,
      };

      if (definition.globalMesgNum === 20) {
        const record = extractRecordData(parsedFields, timestamp, recordOrdinalCounter);
        message.recordOrdinal = recordOrdinalCounter;
        recordOrdinalCounter += 1;
        records.push(record);
      }

      messages.push(message);
      continue;
    }

    const isDefinition = (header & 0x40) !== 0;
    const hasDeveloperData = (header & 0x20) !== 0;
    const localMesgNum = header & 0x0f;

    if (isDefinition) {
      const definition = parseDefinitionMessage(
        view,
        bytes,
        position,
        localMesgNum,
        hasDeveloperData
      );
      position = definition.nextPosition;
      definitions.set(localMesgNum, definition);

      messages.push({
        raw: bytes.slice(messageStart, position),
        isDefinition: true,
        isData: false,
        localMesgNum,
        globalMesgNum: definition.globalMesgNum,
        timestamp: null,
        recordOrdinal: null,
      });
      continue;
    }

    const definition = definitions.get(localMesgNum);
    if (!definition) {
      throw new Error(`Chybi definice pro local message ${localMesgNum}.`);
    }

    const payloadStart = position;
    const payloadEnd = payloadStart + definition.dataSize;
    if (payloadEnd > dataEnd) {
      throw new Error("Data message presahuje konec FIT dat.");
    }

    const parsedFields = decodeDataFields(view, payloadStart, definition);
    position = payloadEnd;

    let timestamp = parsedFields.get(253);
    if (Number.isFinite(timestamp)) {
      lastTimestamp = timestamp;
    } else {
      timestamp = null;
    }

    const message = {
      raw: bytes.slice(messageStart, payloadEnd),
      isDefinition: false,
      isData: true,
      localMesgNum,
      globalMesgNum: definition.globalMesgNum,
      timestamp,
      recordOrdinal: null,
    };

    if (definition.globalMesgNum === 20) {
      const record = extractRecordData(parsedFields, timestamp, recordOrdinalCounter);
      message.recordOrdinal = recordOrdinalCounter;
      recordOrdinalCounter += 1;
      records.push(record);
    }

    messages.push(message);
  }

  return {
    header: {
      protocolVersion,
      profileVersion,
    },
    messages,
    records,
  };
}

function parseDefinitionMessage(view, bytes, startPosition, localMesgNum, hasDeveloperData) {
  let position = startPosition;
  const reserved = bytes[position];
  position += 1;
  void reserved;

  const architecture = bytes[position];
  position += 1;
  const littleEndian = architecture === 0;

  const globalMesgNum = view.getUint16(position, littleEndian);
  position += 2;

  const fieldCount = bytes[position];
  position += 1;

  const fields = [];
  let dataSize = 0;
  for (let i = 0; i < fieldCount; i += 1) {
    const fieldDefNum = bytes[position];
    const size = bytes[position + 1];
    const baseType = bytes[position + 2];
    position += 3;
    fields.push({ fieldDefNum, size, baseType });
    dataSize += size;
  }

  const developerFields = [];
  if (hasDeveloperData) {
    const developerFieldCount = bytes[position];
    position += 1;
    for (let i = 0; i < developerFieldCount; i += 1) {
      const fieldDefNum = bytes[position];
      const size = bytes[position + 1];
      const developerDataIndex = bytes[position + 2];
      position += 3;
      developerFields.push({ fieldDefNum, size, developerDataIndex });
      dataSize += size;
    }
  }

  return {
    localMesgNum,
    globalMesgNum,
    littleEndian,
    fields,
    developerFields,
    dataSize,
    nextPosition: position,
  };
}

function decodeDataFields(view, payloadStart, definition) {
  const map = new Map();
  let cursor = payloadStart;

  for (const field of definition.fields) {
    const value = decodeFieldValue(
      view,
      cursor,
      field.size,
      field.baseType,
      definition.littleEndian
    );
    map.set(field.fieldDefNum, value);
    cursor += field.size;
  }

  for (const field of definition.developerFields) {
    cursor += field.size;
  }

  return map;
}

function decodeFieldValue(view, offset, size, baseType, littleEndian) {
  const baseTypeNum = baseType & 0x1f;
  const baseSize = BASE_TYPE_SIZES[baseTypeNum];

  if (baseTypeNum === 7) {
    const chars = [];
    for (let i = 0; i < size; i += 1) {
      const code = view.getUint8(offset + i);
      if (code === 0) {
        break;
      }
      chars.push(String.fromCharCode(code));
    }
    return chars.join("");
  }

  if (!baseSize || size !== baseSize) {
    return null;
  }

  switch (baseTypeNum) {
    case 0:
    case 2:
    case 10:
    case 13: {
      const value = view.getUint8(offset);
      if (value === 0xff) {
        return null;
      }
      if (baseTypeNum === 10 && value === 0) {
        return null;
      }
      return value;
    }
    case 1: {
      const value = view.getInt8(offset);
      return value === 0x7f ? null : value;
    }
    case 3: {
      const value = view.getInt16(offset, littleEndian);
      return value === 0x7fff ? null : value;
    }
    case 4: {
      const value = view.getUint16(offset, littleEndian);
      return value === 0xffff ? null : value;
    }
    case 11: {
      const value = view.getUint16(offset, littleEndian);
      return value === 0 ? null : value;
    }
    case 5: {
      const value = view.getInt32(offset, littleEndian);
      return value === 0x7fffffff ? null : value;
    }
    case 6: {
      const value = view.getUint32(offset, littleEndian);
      return value === 0xffffffff ? null : value;
    }
    case 12: {
      const value = view.getUint32(offset, littleEndian);
      return value === 0 ? null : value;
    }
    case 8: {
      const value = view.getFloat32(offset, littleEndian);
      return Number.isNaN(value) ? null : value;
    }
    case 9: {
      const value = view.getFloat64(offset, littleEndian);
      return Number.isNaN(value) ? null : value;
    }
    default:
      return null;
  }
}

function extractRecordData(fieldMap, timestamp, recordOrdinal) {
  const positionLatRaw = fieldMap.get(0);
  const positionLonRaw = fieldMap.get(1);
  const distanceRaw = fieldMap.get(5);
  const altitudeRaw = fieldMap.get(2);
  const enhancedAltitudeRaw = fieldMap.get(78);

  const distanceM = Number.isFinite(distanceRaw) ? distanceRaw / 100 : null;

  let altitudeM = null;
  if (Number.isFinite(enhancedAltitudeRaw)) {
    altitudeM = enhancedAltitudeRaw / 5 - 500;
  } else if (Number.isFinite(altitudeRaw)) {
    altitudeM = altitudeRaw / 5 - 500;
  }

  const latDeg = Number.isFinite(positionLatRaw)
    ? positionLatRaw * SEMICIRCLES_TO_DEGREES
    : null;
  const lonDeg = Number.isFinite(positionLonRaw)
    ? positionLonRaw * SEMICIRCLES_TO_DEGREES
    : null;

  return {
    recordOrdinal,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    distanceM,
    altitudeM,
    latDeg,
    lonDeg,
  };
}

function buildTrimmedFit(parsedFit, startRecordOrdinal, endRecordOrdinal) {
  if (startRecordOrdinal > endRecordOrdinal) {
    throw new Error("Neplatny interval segmentu.");
  }

  const startTs = parsedFit.records[startRecordOrdinal]?.timestamp;
  const endTs = parsedFit.records[endRecordOrdinal]?.timestamp;
  const essentials = new Set([0, 49, 206, 207]);

  const selectedMessages = [];
  for (const message of parsedFit.messages) {
    if (message.isDefinition) {
      selectedMessages.push(message.raw);
      continue;
    }

    if (!message.isData) {
      continue;
    }

    if (message.globalMesgNum === 20) {
      if (
        Number.isInteger(message.recordOrdinal) &&
        message.recordOrdinal >= startRecordOrdinal &&
        message.recordOrdinal <= endRecordOrdinal
      ) {
        selectedMessages.push(message.raw);
      }
      continue;
    }

    if (essentials.has(message.globalMesgNum)) {
      selectedMessages.push(message.raw);
      continue;
    }

    if (
      Number.isFinite(startTs) &&
      Number.isFinite(endTs) &&
      Number.isFinite(message.timestamp) &&
      message.timestamp >= startTs &&
      message.timestamp <= endTs
    ) {
      selectedMessages.push(message.raw);
    }
  }

  if (!selectedMessages.length) {
    throw new Error("Nepodarilo se slozit vystupni FIT soubor.");
  }

  const dataSize = selectedMessages.reduce((sum, message) => sum + message.length, 0);
  const dataBytes = new Uint8Array(dataSize);
  let offset = 0;
  for (const message of selectedMessages) {
    dataBytes.set(message, offset);
    offset += message.length;
  }

  const header = new Uint8Array(14);
  const headerView = new DataView(header.buffer);
  header[0] = 14;
  header[1] = parsedFit.header.protocolVersion ?? 0x10;
  headerView.setUint16(2, parsedFit.header.profileVersion ?? 0, true);
  headerView.setUint32(4, dataSize, true);
  header[8] = 0x2e;
  header[9] = 0x46;
  header[10] = 0x49;
  header[11] = 0x54;
  const headerCrc = computeFitCrc(header.slice(0, 12));
  headerView.setUint16(12, headerCrc, true);

  const fileCrc = computeFitCrc(dataBytes);
  const output = new Uint8Array(header.length + dataBytes.length + 2);
  output.set(header, 0);
  output.set(dataBytes, header.length);

  const outputView = new DataView(output.buffer);
  outputView.setUint16(header.length + dataBytes.length, fileCrc, true);

  return output.buffer;
}

function expandCompressedTimestamp(lastTimestamp, offset5bit) {
  const base = lastTimestamp & ~0x1f;
  let expanded = base + offset5bit;
  if (expanded <= lastTimestamp) {
    expanded += 0x20;
  }
  return expanded;
}

function computeFitCrc(bufferLike) {
  const bytes = bufferLike instanceof Uint8Array ? bufferLike : new Uint8Array(bufferLike);
  let crc = 0;

  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc ^= tmp ^ CRC_TABLE[byte & 0x0f];

    tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc ^= tmp ^ CRC_TABLE[(byte >> 4) & 0x0f];
  }

  return crc & 0xffff;
}

function downloadBinary(arrayBuffer, fileName) {
  const blob = new Blob([arrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatDistance(distanceM) {
  return `${(distanceM / 1000).toFixed(2)} km`;
}

function formatSpeed(speedKmh) {
  return `${speedKmh.toFixed(2)} km/h`;
}

function formatAscent(ascentM) {
  return `${Math.round(ascentM)} m`;
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const BASE_TYPE_SIZES = {
  0: 1,
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 4,
  6: 4,
  7: 1,
  8: 4,
  9: 8,
  10: 1,
  11: 2,
  12: 4,
  13: 1,
  14: 8,
  15: 8,
  16: 8,
};

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00,
  0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];
