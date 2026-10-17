const form = document.querySelector('form');
const roles = [...document.querySelectorAll('input[name="varsityRole"]')];
const programs = [...document.querySelectorAll('input[name="varsityPrograms"]')];
function updateParticipation() {
  const role = roles.find((input) => input.checked)?.value;
  const varsity = Boolean(role && role !== 'none');
  for (const input of programs) input.disabled = !varsity;
  const selected = programs.some((input) => input.checked);
  programs[0]?.setCustomValidity(
    varsity && !selected ? 'Select at least one Brock varsity program' : '',
  );
}
form?.addEventListener('change', updateParticipation);
updateParticipation();
