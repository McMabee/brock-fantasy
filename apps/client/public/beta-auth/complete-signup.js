(() => {
  const form = document.getElementById('complete-signup');
  if (!(form instanceof HTMLFormElement) || form.dataset.submitting === 'true') return;

  form.addEventListener('submit', (event) => {
    if (form.dataset.submitting === 'true') event.preventDefault();
    else form.dataset.submitting = 'true';
  });
  form.requestSubmit();
})();
