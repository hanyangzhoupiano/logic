<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logic Gates</title>
  <link rel="stylesheet" href="main.css">
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="ui">
    <div id="hud">
      <div id="level-info" class="panel">
        <h1 id="level-title">Level 1</h1>
        <p id="level-desc"></p>
      </div>
      <div id="goal-box" class="panel">
        <div class="label">Goal</div>
        <div class="pattern" id="goal-pattern"></div>
        <div class="case" id="goal-case"></div>
      </div>
    </div>
    <div id="hint" class="panel">Drag components · Connect ports on release · E toggle lever / disconnect</div>
    <div id="win-overlay">
      <div id="win-card" class="panel">
        <h2 id="win-title">Level Complete!</h2>
        <p id="win-msg">Nice work.</p>
        <button id="btn-next">Next Level</button>
        <button id="btn-replay" class="secondary">Replay</button>
      </div>
    </div>
  </div>
  <script src="main.js"></script>
</body>
</html>
