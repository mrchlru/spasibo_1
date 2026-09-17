/**
 * Скачивает Excel/Blob из ответа axios (ПК / обычный браузер).
 *
 * @param {import('axios').AxiosResponse<Blob>} response
 * @param {string} filename
 */
export async function downloadExcelBlob(response, filename) {
  let blob = response.data;
  if (!(blob instanceof Blob)) {
    blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
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
    : new Blob([blob], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

  const url = window.URL.createObjectURL(excelBlob);
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
