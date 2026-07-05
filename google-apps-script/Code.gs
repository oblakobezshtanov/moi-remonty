const SHEET_NAME = 'Клиенты';
const HEADERS = [
  'ID', 'Дата', 'Статус', 'Имя', 'Телефон', 'Адрес',
  'Стоимость ремонта, €', 'Расстояние в одну сторону, км',
  'Расстояние туда и обратно, км', 'Топливо, л', 'Затраты на бензин, €',
  'Комплектующие, €', 'Все расходы, €', 'Прибыль, €', 'Комментарий', 'Обновлено'
];

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold').setBackground('#14283d').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
}

function setAppSecret() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt('Секретный ключ', 'Введите длинный ключ для приложения:', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty('APP_SECRET', result.getResponseText());
    ui.alert('Ключ сохранён');
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('APP_SECRET');
    if (!expected || payload.secret !== expected) return response({ ok: false, error: 'Неверный ключ' });
    const job = payload.job || {};
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Сначала запустите функцию setup');

    const row = [[
      job.id, job.date, job.status, job.name, job.phone, job.address,
      job.repairPrice, job.distanceKm, job.roundTripKm, job.fuelLiters,
      job.fuelCost, job.partsCost, job.totalCosts, job.profit, job.comment,
      job.updatedAt
    ]];

    const values = sheet.getDataRange().getValues();
    const index = values.findIndex((item, i) => i > 0 && String(item[0]) === String(job.id));
    if (index >= 0) sheet.getRange(index + 1, 1, 1, HEADERS.length).setValues(row);
    else sheet.appendRow(row[0]);
    return response({ ok: true });
  } catch (error) {
    return response({ ok: false, error: String(error) });
  }
}

function response(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
