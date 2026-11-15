document.getElementById('product-form')?.addEventListener('submit', event => {
  event.preventDefault();
  const input = document.getElementById('product-id');
  if (!(input instanceof HTMLInputElement) || !input.reportValidity()) return;
  window.location.assign(`/v/${encodeURIComponent(input.value.trim())}`);
});
