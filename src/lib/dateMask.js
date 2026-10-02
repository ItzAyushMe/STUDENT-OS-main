// FIX-EXAM: masked date input — digits → YYYY-MM-DD. Numeric keyboard can't type '-',
// so we accept default keyboard and auto-insert dashes. Keeps storage format unchanged.
// Extracted to shared lib for FIX-TEST coverage (import-only change in screens).
export function maskDateInput(v) {
  const digits = String(v || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
export function isValidDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
}
