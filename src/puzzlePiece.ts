// src/puzzlePiece.ts (Rappel et Ajustement mineur)
import { Mesh, Texture, StandardMaterial, Scene, Vector3, MeshBuilder, Color3, Vector4 } from '@babylonjs/core';

export class PuzzlePiece {
    public mesh: Mesh;
    public originalPosition: Vector3;   // La position correcte de la pièce
    public currentPosition: Vector3;    // La position actuelle de la pièce
    public originalIndex: number;      // L'index de la pièce dans la grille résolue
    public isLocked: boolean = false;   // Indique si la pièce est à sa place

    // Propriétés de grille (rendues publiques ou utilisées pour des méthodes)
    public readonly row: number; // Position correcte de la pièce dans la grille (ligne)
    public readonly col: number; // Position correcte de la pièce dans la grille (colonne)

    private _scene: Scene;
    private _tileWidth: number;
    private _tileHeight: number;
    private _depth: number;
    private _snapMargin: number = 0.05; // Note: Utilisé uniquement dans checkAndLock de cette classe. Game.ts a son propre seuil.

    // NOUVELLES PROPRIÉTÉS POUR LE CALCUL DES UVS (maintenant stockées comme 'row' et 'col')
    private _totalRows: number;
    private _totalCols: number;


    constructor(
        name: string,
        scene: Scene,
        imageTexture: Texture,
        row: number,            // <-- NOUVEAU : Index de la ligne de la pièce (0 à totalRows-1)
        col: number,            // <-- NOUVEAU : Index de la colonne de la pièce (0 à totalCols-1)
        totalRows: number,      // <-- NOUVEAU : Nombre total de lignes dans le puzzle
        totalCols: number,      // <-- NOUVEAU : Nombre total de colonnes dans le puzzle
        babylonTileWidth: number,    // Largeur de la pièce en unité Babylon (calculée dans Game.ts)
        babylonTileHeight: number,   // Hauteur de la pièce en unité Babylon (calculée dans Game.ts)
        pieceIndex: number,
        depth: number = 0.1 // Épaisseur par défaut pour la 3D
    ) {
        this._scene = scene;
        this._tileWidth = babylonTileWidth;
        this._tileHeight = babylonTileHeight;
        this._depth = depth;
        this.originalIndex = pieceIndex;

        // Stocker les infos de grille pour le calcul des UVs et la position originale
        this.row = row; // Rendre public ou utiliser des accesseurs si Game.ts en a besoin
        this.col = col; // Rendre public ou utiliser des accesseurs si Game.ts en a besoin
        this._totalRows = totalRows;
        this._totalCols = totalCols;

        this.mesh = MeshBuilder.CreateBox(name, {
            width: this._tileWidth,
            height: this._tileHeight,
            depth: this._depth,
            faceUV: this.getFaceUVs()
        }, scene);

        // Calcul de la position originale en unités Babylon.js
        const totalPuzzleWidth = this._tileWidth * this._totalCols;
        const totalPuzzleHeight = this._tileHeight * this._totalRows;

        const invCol = this._totalCols - 1 - this.col;  // si nécessaire

        const originalX = (invCol * this._tileWidth) + (this._tileWidth / 2) - (totalPuzzleWidth / 2);
        const originalY = -((this.row * this._tileHeight) + (this._tileHeight / 2) - (totalPuzzleHeight / 2));
     
        const originalZ = 0;

        this.originalPosition = new Vector3(originalX, originalY, originalZ);
        this.currentPosition = new Vector3(originalX, originalY, originalZ); // Initialize currentPosition

        const material = new StandardMaterial(name + "Mat", scene);
        material.diffuseTexture = imageTexture;
        material.specularColor = new Color3(0.1, 0.1, 0.1);
        material.freeze();

        this.mesh.material = material;
        this.mesh.position = this.currentPosition.clone(); // Set mesh position on creation
        this.mesh.isPickable = true;
        this.mesh.metadata = { isPuzzlePiece: true, piece: this };
    }

    private getFaceUVs(): Vector4[] {
        const uMin = this.col / this._totalCols;
        const uMax = (this.col + 1) / this._totalCols;
        const vMin = 1 - (this.row + 1) / this._totalRows;
        const vMax = 1 - this.row / this._totalRows;

        const uvImage = new Vector4(uMax, vMax, uMin, vMin);
        const uvSide = new Vector4(0, 0, 0, 0);

        return [
            uvImage, // Face avant (index 0)
            uvSide,  // Face arrière (index 1)
            uvSide,  // Face supérieure (index 2)
            uvSide,  // Face inférieure (index 3)
            uvSide,  // Face droite (index 4)
            uvSide   // Face gauche (index 5)
        ];
    }

    public setPosition(x: number, y: number, z: number): void {
        this.currentPosition.set(x, y, z);
        this.mesh.position.set(x, y, z);
    }

    // Cette méthode est spécifique pour snaper la pièce à SA propre position finale
    // Elle ne gère pas le snapping aux voisins.
    public checkAndLock(): boolean {
        if (this.isLocked) return true;

        const distanceXY = Math.sqrt(
            Math.pow(this.currentPosition.x - this.originalPosition.x, 2) +
            Math.pow(this.currentPosition.y - this.originalPosition.y, 2)
        );

        // Utilisez _snapMargin pour un snap très précis à sa propre position
        if (distanceXY <= this._snapMargin) {
            this.setPosition(this.originalPosition.x, this.originalPosition.y, this.originalPosition.z + this._depth / 2 + 0.01);
            this.isLocked = true;
            (this.mesh.material as StandardMaterial).emissiveColor = Color3.Green().scale(0.1);
            this.mesh.isPickable = false;
            return true;
        }
        return false;
    }

    // Nouvelle méthode pour snaper directement à la position originale
    public snapToOriginalPosition(): void {
        this.setPosition(this.originalPosition.x, this.originalPosition.y, this.originalPosition.z + this._depth / 2 + 0.01);
        this.isLocked = true;
        (this.mesh.material as StandardMaterial).emissiveColor = Color3.Green().scale(0.1);
        this.mesh.isPickable = false;
    }

    public lock(): void {
        this.isLocked = true;
        this.mesh.isPickable = false;
        if (this.mesh.material instanceof StandardMaterial) {
            this.mesh.material.emissiveColor = Color3.Green().scale(0.1);
        }
    }

    public reset(): void {
        this.isLocked = false;
        this.mesh.isPickable = true;
        if (this.mesh.material instanceof StandardMaterial) {
            this.mesh.material.emissiveColor = Color3.Black();
        }
    }

    public elevate(elevation: number = 0.5): void {
        this.mesh.position.z = elevation;
    }
}