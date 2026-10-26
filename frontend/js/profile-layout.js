// Keeps the profile boxes in one fixed order, above the action buttons.
const ORDER = ["profile-extras", "profile-portfolio", "profile-players", "profile-clubs"];

export function orderProfileBoxes() {
  const actions = document.getElementById("profile-actions");
  if (!actions || !actions.parentNode) return;
  ORDER.forEach((id) => {
    const el = document.getElementById(id);
    if (el) actions.parentNode.insertBefore(el, actions);
  });
}
