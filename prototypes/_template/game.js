const status = document.getElementById("status");
const actionButton = document.getElementById("action");
const restartButton = document.getElementById("restart");

let count = 0;

function resetGame() {
  count = 0;
  status.textContent = "Ready";
  actionButton.textContent = "Press me";
}

actionButton.addEventListener("click", () => {
  count += 1;
  status.textContent = `Interaction ${count}`;
  actionButton.textContent = count > 2 ? "Keep iterating" : "Press again";
});

restartButton.addEventListener("click", resetGame);

resetGame();
