export function bindPasswordVisibilityToggles(selector = '[data-toggle]') {
  document.querySelectorAll(selector).forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const targetId = button.getAttribute('data-toggle');
      if (!targetId) return;

      const input = document.getElementById(targetId);
      if (!input) return;

      const icon = button.querySelector('i');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      button.setAttribute('aria-pressed', isPassword ? 'true' : 'false');

      if (!icon) return;

      const usesSolid = icon.classList.contains('fa-solid') || icon.classList.contains('fas');
      const styleClass = usesSolid ? 'fa-solid' : 'fa-regular';
      icon.className = `${styleClass} ${isPassword ? 'fa-eye-slash' : 'fa-eye'}`;
    });
  });
}
