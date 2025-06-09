// src/index.ts
import { Game } from './game';
import './style.css'; // Importe le CSS pour que Webpack le gère

document.addEventListener('DOMContentLoaded', () => {
    const game = new Game('gameCanvas', 2, 2); // Crée un puzzle 3x3
    game.run();
});