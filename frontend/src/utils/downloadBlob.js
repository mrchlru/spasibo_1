/**
 * Скачивает Excel/Blob из ответа axios.
 * В Android WebView blob+`<a download>` не работает — сохраняем через SpasiboAndroid.
 */

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Размер сырого чанка (~256 KiB), base64 остаётся в лимите Binder. */
const ANDROID_CHUNK_BYTES = 256 * 1024;

/**
 * @returns {boolean}
 */
function _hasAndroidBinaryDownload() {
  const bridge = typeof window !== 'undefined' ? window.SpasiboAndroid : null;
  return Boolean(
    bridge
    && typeof bridge.beginBinaryDownload === 'function'
    && typeof bridge.appendBinaryDownloadChunk === 'function'
    && typeof bridge.finishBinaryDownload === 'function',
  );
}

/**
 * Uint8Array → base64 без переполнения стека.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function _uint8ToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    const slice = bytes.subarray(index, Math.min(index + step, bytes.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/**
 * Сохраняет blob через нативный мост Android.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<boolean>}
 */
async function _saveBlobViaAndroidBridge(blob, filename) {
  const bridge = window.SpasiboAndroid;
  if (!_hasAndroidBinaryDownload()) {
    return false;
  }
  const transferId = bridge.beginBinaryDownload(
    filename,
    blob.type || EXCEL_MIME,
  );
  if (!transferId) {
    return false;
  }
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += ANDROID_CHUNK_BYTES) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + ANDROID_CHUNK_BYTES, bytes.length),
    );
    const ok = bridge.appendBinaryDownloadChunk(transferId, _uint8ToBase64(chunk));
    if (!ok) {
      return false;
    }
  }
  return Boolean(bridge.finishBinaryDownload(transferId));
}

/**
 * Классическое скачивание через `<a download>` (ПК / обычный браузер).
 *
 * @param {Blob} blob
 * @param {string} filename
 */
function _saveBlobViaAnchor(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * Скачивает Excel/Blob из ответа axios.
 *
 * @param {import('axios').AxiosResponse<Blob>} response
 * @param {string} filename
 */
export async function downloadExcelBlob(response, filename) {
  let blob = response.data;
  if (!(blob instanceof Blob)) {
    blob = new Blob([response.data], { type: EXCEL_MIME });
  }

  const contentType = response.headers?.['content-type'] || blob.type || '';
  if (contentType.includes('application/json')) {
    const text = await blob.text();
    let detail = 'Не удалось выгрузить файл';
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail || detail;
      if (Array.isArray(detail)) {
        detail = detail.map((item) => item.msg || String(item)).join('; ');
      }
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : 'Не удалось выгрузить файл');
  }

  const excelBlob = blob.type
    ? blob
    : new Blob([blob], { type: EXCEL_MIME });

  if (_hasAndroidBinaryDownload()) {
    const saved = await _saveBlobViaAndroidBridge(excelBlob, filename);
    if (!saved) {
      throw new Error('Не удалось сохранить файл на устройство');
    }
    return;
  }

  _saveBlobViaAnchor(excelBlob, filename);
}
