const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");

const scale = 20; // Size of the grid cell
const rows = 20; // Number of rows
const columns = 20; // Number of columns

canvas.width = columns * scale;
canvas.height = rows * scale;

let snake = [{ x: 5, y: 5 }]; // Snake starting position
let direction = { x: 1, y: 0 }; // Initial direction of movement
let food = generateFood();
let obstacles = generateObstacles(6); // Generate 6 obstacles
let gameOver = false;
let paused = true; // New paused state to control game start
let score = 0; // Initialize score

// Event listener for keyboard input
document.addEventListener("keydown", (e) => {
  if (gameOver) {
    if (e.key.toLowerCase() === "y") {
      restartGame(); // Restart game
    }
    return;
  }

  if (paused && e.key.toLowerCase() === "y") {
    paused = false; // Resume the game when 'Y' is pressed
    gameLoop(); // Start the game loop if it was paused
    return;
  }

  if (paused) return; // Prevent any movement if game is paused

  switch (e.key) {
    case "ArrowUp":
      if (direction.y === 0) direction = { x: 0, y: -1 }; // Move up
      break;
    case "ArrowDown":
      if (direction.y === 0) direction = { x: 0, y: 1 }; // Move down
      break;
    case "ArrowLeft":
      if (direction.x === 0) direction = { x: -1, y: 0 }; // Move left
      break;
    case "ArrowRight":
      if (direction.x === 0) direction = { x: 1, y: 0 }; // Move right
      break;
  }
});

// Function to generate food at a random position
function generateFood() {
  let foodX, foodY;
  do {
    foodX = Math.floor(Math.random() * columns);
    foodY = Math.floor(Math.random() * rows);
  } while (snake.some((s) => s.x === foodX && s.y === foodY)); // Ensure food is not on the snake
  return { x: foodX, y: foodY };
}

// Function to generate multiple obstacles
function generateObstacles(count) {
  let obstaclesArray = [];
  while (obstaclesArray.length < count) {
    let obstacleX, obstacleY, direction;
    do {
      // Choose random starting point and direction for the obstacle (horizontal or vertical)
      obstacleX = Math.floor(Math.random() * columns);
      obstacleY = Math.floor(Math.random() * rows);
      direction = Math.random() < 0.5 ? "horizontal" : "vertical"; // Random direction (horizontal or vertical)
    } while (
      snake.some((s) => s.x === obstacleX && s.y === obstacleY) || // Ensure obstacle is not on the snake
      (food.x === obstacleX && food.y === obstacleY) || // Ensure obstacle is not on the food
      obstaclesArray.some(o => o.some(block => block.x === obstacleX && block.y === obstacleY)) // Ensure new obstacle doesn't overlap with existing ones
    );

    let obstacleBlocks = [];
    if (direction === "horizontal") {
      for (let i = 0; i < 4; i++) {
        obstacleBlocks.push({ x: obstacleX + i, y: obstacleY });
      }
    } else {
      for (let i = 0; i < 4; i++) {
        obstacleBlocks.push({ x: obstacleX, y: obstacleY + i });
      }
    }

    obstaclesArray.push(obstacleBlocks);
  }
  return obstaclesArray;
}

// Update the game state
function update() {
  if (gameOver || paused || (direction.x === 0 && direction.y === 0)) return;

  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

  // Check for collisions with walls, self, or any of the obstacles
  if (
    head.x < 0 || // Collision with left wall
    head.x >= columns || // Collision with right wall
    head.y < 0 || // Collision with top wall
    head.y >= rows || // Collision with bottom wall
    snake.some((segment) => segment.x === head.x && segment.y === head.y) || // Collision with self
    obstacles.some((obstacle) => obstacle.some((block) => block.x === head.x && block.y === head.y)) // Collision with any obstacle
  ) {
    gameOver = true;
    return;
  }

  snake.unshift(head); // Add new head to the snake

  if (head.x === food.x && head.y === food.y) {
    food = generateFood(); // Generate new food
    score++; // Increase score
  } else {
    snake.pop(); // Remove the tail
  }
}





const foodImage = new Image();
foodImage.src = './body/neonapple.png'; // Replace with the actual path to your image

const headImage = new Image();
headImage.src = './body/head.png'; // Replace with the actual path to the head image

const bodyImage = new Image();
bodyImage.src = './body/bodyyy.png'; // Replace with the actual path to the body image

const obstacleImage = new Image();
obstacleImage.src = './background/Wall1.jpg'; // Replace with the actual path to your obstacle image


// Variable to track if all images are loaded
let imagesLoaded = false;

// Ensure all images are loaded before starting the game
let loadedCount = 0;
const totalImages = 3;

function checkAllImagesLoaded() {
  loadedCount++;
  if (loadedCount === totalImages) {
    imagesLoaded = true;
    console.log('All images loaded! Starting game...');
    gameLoop(); // Start the game loop once images are loaded
  }
}

foodImage.onload = checkAllImagesLoaded;
headImage.onload = checkAllImagesLoaded;
bodyImage.onload = checkAllImagesLoaded;








// Draw the game state
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the snake
  snake.forEach((segment, index) => {
    if (index === 0) {
      // Draw the head
      if (headImage.complete) {
        ctx.drawImage(headImage, segment.x * scale, segment.y * scale, scale, scale);
      } else {
        // Fallback if the image isn't loaded
        ctx.fillStyle = "#00FF00";
        ctx.fillRect(segment.x * scale, segment.y * scale, scale, scale);
      }
    } else {
      // Draw the body
      if (bodyImage.complete) {
        ctx.drawImage(bodyImage, segment.x * scale, segment.y * scale, scale, scale);
      } else {
        // Fallback if the image isn't loaded
        ctx.fillStyle = "#008000";
        ctx.fillRect(segment.x * scale, segment.y * scale, scale, scale);
      }
    }
  });

  
   // Draw the food using an image
   if (foodImage.complete) { // Ensure the image is loaded
    ctx.drawImage(foodImage, food.x * scale, food.y * scale, scale, scale);
  } else {
    // Fallback if image isn't loaded yet
    ctx.fillStyle = "#FF0000";
    ctx.fillRect(food.x * scale, food.y * scale, scale, scale);
  }

  // Draw obstacles using images
  obstacles.forEach((obstacle) => {
    obstacle.forEach((block) => {
      if (obstacleImage.complete) {
        ctx.drawImage(obstacleImage, block.x * scale, block.y * scale, scale, scale);
      } else {
        // Fallback if the image isn't loaded yet
        ctx.fillStyle = "#FFFF00"; // Yellow for obstacle
        ctx.fillRect(block.x * scale, block.y * scale, scale, scale);
      }
    });
  });

  // Draw the score
  ctx.fillStyle = "white";
  ctx.font = "20px Arial";
  ctx.fillText(`Score: ${score}`, 10, 20);

  // Game over message
  if (gameOver) {
    const messageWidth = ctx.measureText("Game Over!").width;
    const messageHeight = 60;
    const padding = 10;

    ctx.fillStyle = "rgb(128, 0, 128)"; // Dark purple color for the border
    ctx.lineWidth = 2;
    ctx.strokeRect(canvas.width / 4 - padding, canvas.height / 2 - messageHeight / 2 - padding, messageWidth + padding * 2, messageHeight + padding * 2);
    ctx.fillStyle = "black";
    ctx.fillRect(canvas.width / 4 - padding, canvas.height / 2 - messageHeight / 2 - padding, messageWidth + padding * 2, messageHeight + padding * 2);

    ctx.fillStyle = "pink";
    ctx.font = "30px Arial, sans-serif";
    ctx.fillText("Game over!", canvas.width / 4, canvas.height / 2 - 20);
    
    ctx.font = "20px Fantasy";
    ctx.fillText("Press 'Y' to Start", canvas.width / 4, canvas.height / 2 + 20);
  }

  // If paused, display a pause message
  if (paused && !gameOver) {
    ctx.fillStyle = "white";
    ctx.font = "20px Arial, sans-serif";
    ctx.fillText("Press 'Y' to Start", canvas.width / 4, canvas.height / 2);
  }
}

// Restart the game
function restartGame() {
  snake = [{ x: 5, y: 5 }];
  direction = { x: 1, y: 0 };
  food = generateFood();
  obstacles = generateObstacles(6); 
  score = 0;
  gameOver = false;
  paused = false; // Game will start or resume after 'Y' is pressed
  gameLoop(); // Start the game loop
}

// Start the game loop
function gameLoop() {
  update();
  draw();
  if (!gameOver && !paused) {
    setTimeout(gameLoop, 100); // Continue game loop if not over and not paused
  }
}

gameLoop(); // Start the game (paused initially)
