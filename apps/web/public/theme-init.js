(function () {
  try {
    var theme = localStorage.getItem("custody-wallet-theme");
    document.documentElement.setAttribute(
      "data-theme",
      theme === "dark" ? "dark" : "light",
    );
  } catch (e) {}
})();
