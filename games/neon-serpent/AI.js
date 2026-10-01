const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d");

const scale = 20;
const rows = 20;
const columns = 20;

canvas.width = columns * scale;
canvas.height = rows * scale;

let snake = [{ x: 5, y: 5 }];
let obstacles = []; 
let food = {}; 
let gameOver = false;
let score = 0;

// Generates a new food position for the snake game.
// The food position is randomly selected within the game grid,
// ensuring it does not overlap with the snake's body.
//
// return {Object}: An object representing the food position with 'x' and 'y' coordinates.
//

// Generates a new food position for the snake game, ensuring it doesn't overlap with the snake's body or obstacles.
function generateFood() {
  let foodX, foodY;
  do {
    foodX = Math.floor(Math.random() * columns);
    foodY = Math.floor(Math.random() * rows);
  } while (
    snake.some((s) => s.x === foodX && s.y === foodY) || // Check if food is on the snake's body
    obstacles.some(
      (
        obstacle // Check if food overlaps with obstacles
      ) => obstacle.some((block) => block.x === foodX && block.y === foodY)
    )
  );

  console.log("Food generated at:", { x: foodX, y: foodY }); // debug purposes
  return { x: foodX, y: foodY };
}

function generateObstacles(count) {
  let obstaclesArray = []; //store obstacles in array
  while (obstaclesArray.length < count) {
    //loop until number of obstacles reaches count which is 6
    let obstacleX, obstacleY, direction;
    do {
      obstacleX = Math.floor(Math.random() * columns); //generate obstacle in x and y coordinates inside grid, direction is vertical or horizontal
      obstacleY = Math.floor(Math.random() * rows); //placement of obstacles
      direction = Math.random() < 0.5 ? "horizontal" : "vertical";
    } while (
      snake.some((s) => s.x === obstacleX && s.y === obstacleY) || // the loop checks several conditions to avoid generating
      (food.x === obstacleX && food.y === obstacleY) || //an obstacle in an invalid position.
      obstaclesArray.some((o) =>
        o.some((block) => block.x === obstacleX && block.y === obstacleY)
      )
    );

    let obstacleBlocks = []; //array to store individual blocks
    if (direction === "horizontal") {
      for (let i = 0; i < 4; i++) {
        //If the obstacle is horizontal, 4 consecutive x values are generated at the same y position.
        obstacleBlocks.push({ x: obstacleX + i, y: obstacleY });
      }
    } else {
      for (let i = 0; i < 4; i++) {
        //If the obstacle is vertical, 4 consecutive y values are generated at the same x position.
        obstacleBlocks.push({ x: obstacleX, y: obstacleY + i });
      }
    }

    obstaclesArray.push(obstacleBlocks); //after generating obstacle it is added to the obstaclesArray

    console.log("Obstacle generated at:", obstacleBlocks); //debug purposes
  }
  return obstaclesArray;
}
// BFS function to find the shortest path
function bfs(start, target) {
  //starting position of the snake is its head and the target is the food
  const queue = [start]; //holds position to process next. Starts with start.
  const visited = Array.from(
    { length: rows },
    () =>
      //2d array to keep track of visited position
      Array(columns).fill(false) //each position would be initially (false) or unvisited.
  );
  visited[start.y][start.x] = true; //initial position would be initialized as true

  const directions = [
    // Possible movements.
    { x: 0, y: -1 }, // Up
    { x: 0, y: 1 }, // Down
    { x: -1, y: 0 }, // Left
    { x: 1, y: 0 }, // Right
  ];

  const parent = {}; //An object (dictionary in layman's terms) to reconstruct the path once the target (food) is found.

  const snakeBody = new Set(snake.map((s) => `${s.x},${s.y}`)); // To efficiently track the positions of the snake's body on the grid.

  while (queue.length > 0) {
    //processes positions in the queue until it is empty or the target is found.
    const current = queue.shift(); //this removes the first position in queue and it stores it in current

    // Check if we've reached the target
    if (current.x === target.x && current.y === target.y) {
      //Once it reaches the target (food), it starts reconstructing the path from the
      const path = []; //food back to the snake’s head using the parent array.
      let temp = current;
      while (temp) {
        path.unshift(temp); //Adds each step to the front of the path array to maintain the correct order from head to food.
        temp = parent[`${temp.x},${temp.y}`]; //Traces the path backward using the parent object.
      }
      return path;
    }

    for (const dir of directions) {
      const neighbor = { x: current.x + dir.x, y: current.y + dir.y }; //For each direction, the algorithm calculates the neighboring position (neighbor) from the current position
      if (
        neighbor.x >= 0 && //is within game grid (not outside left boundary)
        neighbor.x < columns && //is within game grid (not outside right boundary)
        neighbor.y >= 0 && //is within game grid (not outside top boundary)
        neighbor.y < rows && //is within game grid (not outside bottom boundary)
        !visited[neighbor.y][neighbor.x] && //This checks if the neighbor position has already been visited during the search
        !snakeBody.has(`${neighbor.x},${neighbor.y}`) && // used to check whether the neighbor (the potential next step for the snake) is occupied by the snake's body (avoiding the snake body)y
        !obstacles.some(
          (
            obstacle //checks if the neighbor position (where the snake wants to go) is
          ) =>
            obstacle.some(
              (block) => block.x === neighbor.x && block.y === neighbor.y //free of obstacles. If the position is free, the snake can move
            ) //  //there; otherwise, it can't.
        )
      ) {
        visited[neighbor.y][neighbor.x] = true; //marks the position as explored
        queue.push(neighbor); // If the neighbor is valid, it is added to the queue for further exploration.
        parent[`${neighbor.x},${neighbor.y}`] = current; // Tracks the parent position of each explored cell, allowing us to reconstruct the path once we reach the food.
      }
    }
  }

  return null; // No path found if queue is empty
}

function update() {
  if (gameOver) return; //if game over, the game stops and there will be no more updates to the game that will happen until game restart (pressing y)

  const path = bfs(snake[0], food); //calls the bfs function -> finds the shortest path from the snakes head to the food
  if (!path || path.length < 2) {
    gameOver = true; //if no path is found or path is short (snake cant move) then game is over
    return;
  }

  const nextStep = path[1]; //Move the snake in the direction of the next step
  const head = { x: nextStep.x, y: nextStep.y }; //Setting the new head position

  // Avoid collision with snake's body and obstacles
  if (
    head.x < 0 || //checks if new head is not in the grid and has passed left boundary
    head.x >= columns || //checks if new head is not in the grid and has passed right boundary
    head.y < 0 || //checks if new head is not in the grid and has passed top boundary
    head.y >= rows || // checks if new head is not in the grid and has passed bottom boundary
    snake.some((segment) => segment.x === head.x && segment.y === head.y) || //checks if new head hits or eats the snake's body
    obstacles.some(
      (
        obstacle //checks if the neighbor position (where the snake wants to go) is
      ) => obstacle.some((block) => block.x === head.x && block.y === head.y) //free of obstacles. If the position is free, the snake can move
    ) //there; otherwise, it can't.
  ) {
    gameOver = true; //then game-over
    return;
  }

  snake.unshift(head); //adding the new head of the snake to the front

  if (head.x === food.x && head.y === food.y) {
    //if the new head reaches and eats the food, a new food is generated and the score goes up by 1
    food = generateFood(); //Generate new food
    score++;
  } else {
    snake.pop(); //If snake doesn't eat the food, it just moves by removing the tail (pop) so that the snake keeps the same length.
  }
}
//restart
function restartGame() {
  snake = [{ x: 5, y: 5 }];
  obstacles = generateObstacles(6);
  food = generateFood();
  gameOver = false;
  score = 0;
  gameLoop();
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

//for canvas, snake, food, obstacles, gameover etc.
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
 
   // Display score
   ctx.fillStyle = "white";
   ctx.font = "20px Arial";
   ctx.fillText(`Score: ${score}`, 10, 20);
 
   // Display Game Over message
   if (gameOver) {
    // Draw a border around the "Game Over" message
    const messageWidth = ctx.measureText("Game Over!").width;
    const messageHeight = 60; // Set the height for the box
    const padding = 10; // Padding around the text

    ctx.fillStyle = "rgb(128, 0, 128)"; // Dark purple color for the border
    ctx.lineWidth = 2; // Border width
    ctx.strokeRect(canvas.width / 4 - padding, canvas.height / 2 - messageHeight / 2 - padding, messageWidth + padding * 2, messageHeight + padding * 2); // Draw the border
    ctx.fillStyle = "black"; // Background color inside the box
    ctx.fillRect(canvas.width / 4 - padding, canvas.height / 2 - messageHeight / 2 - padding, messageWidth + padding * 2, messageHeight + padding * 2); // Fill background with black
    
    // Draw the "Game Over!" text
    ctx.fillStyle = "pink"; // Text color
    ctx.font = "30px Arial, sans-serif"; // Font style
    ctx.fillText("Play?", canvas.width / 4, canvas.height / 2 - 20);
    
    // Draw the "Press 'Y' to Restart" message
    ctx.font = "20px Fantasy"; // Font style for restart message
    ctx.fillText("Press 'Y' to Start", canvas.width / 4, canvas.height / 2 + 20);
}

 }

//press y to restart
document.addEventListener("keydown", (e) => {
  if (gameOver && e.key.toLowerCase() === "y") {
    restartGame();
  }
});


function gameLoop() {
  update();
  draw();
  if (!gameOver) {
    setTimeout(gameLoop, 100);
  }
}

gameLoop();