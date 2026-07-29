// Formattazione importi (sempre da centesimi interi) e date locali.

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  const intStr = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${intStr},${dec} €`;
}

// Data LOCALE, mai toISOString (che è UTC e a mezzanotte sbaglia giorno).
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthOf(iso) {
  return iso.slice(0, 7);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
