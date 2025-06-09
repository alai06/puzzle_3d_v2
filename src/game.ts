// src/game.ts
import {
    Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, StandardMaterial, Color3, Texture, PointerEventTypes, PointerInfo,
    MeshBuilder, Mesh, Camera, Plane, Matrix, Animatable, Animation, WebXRDefaultExperience, WebXRInputSource, WebXRState, Ray
} from '@babylonjs/core';
import { PuzzlePiece } from './puzzlePiece';
import puzzleImageUrl from './assets/puzzle.jpg';

export class Game {
    private _engine: Engine;
    private _scene: Scene;
    private _canvas: HTMLCanvasElement;
    private _puzzlePieces: PuzzlePiece[] = [];
    private _rows: number;
    private _cols: number;

    private _puzzleWidth!: number;
    private _puzzleHeight!: number;
    private _pieceDepth: number = 0.1;
    private _imageTexture!: Texture;

    private _draggedPiece: PuzzlePiece | null = null;
    private _dragOffset: Vector3 = Vector3.Zero();
    private _ground!: Mesh;
    private _xrExperience: WebXRDefaultExperience | null = null;

    private _isGameSolved: boolean = false;
    private _messageDisplay: HTMLParagraphElement;
    private _resetButton: HTMLButtonElement;

    constructor(canvasId: string, rows: number, cols: number) {
        const canvasElement = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!canvasElement) throw new Error(`Canvas avec ID '${canvasId}' non trouvé !`);
        this._canvas = canvasElement;

        const messageElement = document.getElementById('message') as HTMLParagraphElement;
        if (!messageElement) throw new Error(`Élément avec ID 'message' non trouvé !`);
        this._messageDisplay = messageElement;

        const resetButtonElement = document.getElementById('resetButton') as HTMLButtonElement;
        if (!resetButtonElement) throw new Error(`Bouton avec ID 'resetButton' non trouvé !`);
        this._resetButton = resetButtonElement;

        this._engine = new Engine(this._canvas, true, { preserveDrawingBuffer: true, stencil: true });
        this._scene = new Scene(this._engine);
        this._rows = rows;
        this._cols = cols;

        this._setupScene();
        this._setupXR(); // Nouvelle méthode pour configurer WebXR
        this._imageTexture = new Texture(puzzleImageUrl, this._scene);

        this._imageTexture.onLoadObservable.add(() => {
            this._createPuzzle();
            this._shufflePuzzle();
            this._addEventListeners();
            this._engine.runRenderLoop(() => {
                this._scene.render();
            });
        });

        window.addEventListener('resize', () => {
            this._engine.resize();
        });

        this._resetButton.addEventListener('click', () => this.resetGame());
    }

    private async _setupScene(): Promise<void> {
        // Caméra classique (utilisée en mode non-VR)
        const camera = new ArcRotateCamera(
            'camera',
            Math.PI / 2,
            Math.PI / 2.5,
            10,
            Vector3.Zero(),
            this._scene
        );
        camera.attachControl(this._canvas, true);
        camera.lowerRadiusLimit = 1;
        camera.upperRadiusLimit = 20;
        camera.wheelPrecision = 50;

        new HemisphericLight('light', new Vector3(0, 1, 0), this._scene);

        // Sol pour l'environnement VR (visible)
        this._ground = MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, this._scene);
        this._ground.position.y = -1; // Abaissé pour être sous les pièces
        const groundMaterial = new StandardMaterial("groundMat", this._scene);
        groundMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
        this._ground.material = groundMaterial;
        this._ground.isPickable = true;
    }
    private async _setupXR(): Promise<void> {
    try {
        console.log("Initialisation de WebXR...");
        this._xrExperience = await WebXRDefaultExperience.CreateAsync(this._scene, {
            floorMeshes: [this._ground],
            disableDefaultUI: false,
            optionalFeatures: true,
            inputOptions: {
                doNotLoadControllerMeshes: true // Désactiver le chargement des modèles de contrôleur
            }
        });
        console.log("WebXR initialisé avec succès");

        // Stocker l'état précédent du trigger pour détecter les changements
        const triggerStates: Map<string, boolean> = new Map();

        this._xrExperience.input.onControllerAddedObservable.add((controller: WebXRInputSource) => {
            console.log("Contrôleur ajouté:", controller.uniqueId);
            controller.onMotionControllerInitObservable.add(() => {
                const motionController = controller.motionController;
                if (motionController) {
                    console.log("MotionController initialisé:", motionController.profileId);
                    // Initialiser l'état du trigger pour ce contrôleur
                    triggerStates.set(controller.uniqueId, false);

                    // Ajouter un pointeur visuel
                    const laserPointer = MeshBuilder.CreateTube("laser", {
                        path: [Vector3.Zero(), new Vector3(0, 0, -1)],
                        radius: 0.01,
                        tessellation: 12,
                        updatable: true
                    }, this._scene);
                    laserPointer.parent = controller.pointer;
                    const laserMaterial = new StandardMaterial("laserMat", this._scene);
                    laserMaterial.emissiveColor = Color3.Red();
                    laserPointer.material = laserMaterial;
                }
            });
        });

        // Gérer les interactions dans la boucle de rendu
        this._scene.onBeforeRenderObservable.add(() => {
            if (!this._xrExperience || this._isGameSolved) return;

            this._xrExperience.input.controllers.forEach((controller) => {
                const motionController = controller.motionController;
                if (motionController) {
                    const triggerComponent = motionController.getComponent("xr-standard-trigger");
                    if (triggerComponent) {
                        const isPressed = triggerComponent.pressed;
                        const previousState = triggerStates.get(controller.uniqueId) ?? false;

                        // Créer un rayon à partir du contrôleur
                        const ray = new Ray(Vector3.Zero(), Vector3.Forward());
                        controller.getWorldPointerRayToRef(ray, true);

                        // Détecter la pression du trigger
                        if (isPressed && !previousState) {
                            const pickResult = this._scene.pickWithRay(ray);
                            if (pickResult?.hit && pickResult.pickedMesh?.metadata?.isPuzzlePiece) {
                                this._draggedPiece = pickResult.pickedMesh.metadata.piece;
                                if (this._draggedPiece && !this._draggedPiece.isLocked) {
                                    this._draggedPiece.elevate(this._pieceDepth * 2);
                                    this._dragOffset = pickResult.pickedPoint!.subtract(this._draggedPiece.mesh.position);
                                }
                            }
                        }
                        // Détecter le relâchement du trigger
                        else if (!isPressed && previousState) {
                            if (this._draggedPiece) {
                                this._snapPiece(this._draggedPiece);
                                this._draggedPiece = null;
                                this._dragOffset = Vector3.Zero();
                                this._checkWinCondition();
                            }
                        }

                        // Mettre à jour l'état précédent
                        triggerStates.set(controller.uniqueId, isPressed);

                        // Déplacer la pièce si saisie
                        if (this._draggedPiece) {
                            const pickResult = this._scene.pickWithRay(ray);
                            if (pickResult?.pickedPoint) {
                                const newPosition = pickResult.pickedPoint.subtract(this._dragOffset);
                                this._draggedPiece.setPosition(newPosition.x, newPosition.y, this._draggedPiece.mesh.position.z);
                            }
                        }
                    }
                }
            });
        });

        // Entrée et sortie du mode XR
        this._xrExperience.baseExperience.onStateChangedObservable.add((state) => {
            if (state === WebXRState.IN_XR) {
                this._scene.activeCamera?.detachControl();
            } else {
                (this._scene.activeCamera as ArcRotateCamera)?.attachControl(this._canvas, true);
            }
        });
    } catch (err) {
        console.error("Erreur lors de l'initialisation de WebXR:", err);
    }
}
    private _createPuzzle(): void {
        const imgWidth = this._imageTexture.getSize().width;
        const imgHeight = this._imageTexture.getSize().height;

        this._puzzleWidth = 2; // Réduit pour faciliter l'interaction en VR
        this._puzzleHeight = (imgHeight / imgWidth) * this._puzzleWidth;

        const tileWidth = this._puzzleWidth / this._cols;
        const tileHeight = this._puzzleHeight / this._rows;

        let pieceIndex = 0;
        for (let r = 0; r < this._rows; r++) {
            for (let c = 0; c < this._cols; c++) {
                const piece = new PuzzlePiece(
                    `piece-${pieceIndex}`,
                    this._scene,
                    this._imageTexture,
                    r,
                    c,
                    this._rows,
                    this._cols,
                    tileWidth,
                    tileHeight,
                    pieceIndex,
                    this._pieceDepth
                );
                this._puzzlePieces.push(piece);
                pieceIndex++;
            }
        }
    }

    private _shufflePuzzle(): void {
        const spreadRadiusX = this._puzzleWidth * 1.5;
        const spreadRadiusY = this._puzzleHeight * 1.5;
        const spreadRadiusZ = 1; // Réduit pour VR

        this._puzzlePieces.forEach(piece => {
            piece.reset();
            const randomX = (Math.random() - 0.5) * spreadRadiusX;
            const randomY = (Math.random() - 0.5) * spreadRadiusY;
            const randomZ = (Math.random() - 0.5) * spreadRadiusZ + 1; // Élevé pour être à portée en VR

            piece.setPosition(randomX, randomY, randomZ);
            piece.currentPosition = piece.mesh.position.clone();
        });
        this._isGameSolved = false;
        this._messageDisplay.textContent = '';
    }

    private _addEventListeners(): void {
        this._scene.onPointerObservable.add((pointerInfo) => {
            if (this._isGameSolved || this._xrExperience?.baseExperience.state === WebXRState.IN_XR) return;

            if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
                const pickResult = this._scene.pick(this._scene.pointerX, this._scene.pointerY);
                if (pickResult?.hit && pickResult.pickedMesh?.metadata?.isPuzzlePiece) {
                    this._draggedPiece = pickResult.pickedMesh.metadata.piece;
                    if (this._draggedPiece && !this._draggedPiece.isLocked) {
                        this._draggedPiece.elevate(this._pieceDepth * 2);
                        const intersectionPoint = pickResult.pickedPoint;
                        if (intersectionPoint) {
                            this._dragOffset = intersectionPoint.subtract(this._draggedPiece.mesh.position);
                        } else {
                            console.warn("POINTERDOWN - Le point d'intersection était nul.");
                            this._dragOffset = Vector3.Zero();
                        }
                        (this._scene.activeCamera as ArcRotateCamera).detachControl();
                    }
                }
            } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
                if (this._draggedPiece) {
                    (this._scene.activeCamera as ArcRotateCamera).attachControl(this._canvas, true);
                    this._snapPiece(this._draggedPiece);
                    this._draggedPiece = null;
                    this._dragOffset = Vector3.Zero();
                    this._checkWinCondition();
                }
            } else if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
                if (this._draggedPiece && !this._isGameSolved && !this._draggedPiece.isLocked) {
                    const ray = this._scene.createPickingRay(
                        this._scene.pointerX,
                        this._scene.pointerY,
                        Matrix.Identity(),
                        this._scene.activeCamera
                    );

                    const dragPlane = Plane.FromPositionAndNormal(
                        new Vector3(0, 0, this._draggedPiece.mesh.position.z),
                        Vector3.Backward()
                    );

                    const distance = ray.intersectsPlane(dragPlane);
                    if (distance !== null) {
                        const pickedPointOnPlane = ray.origin.add(ray.direction.scale(distance));
                        const newPosition = pickedPointOnPlane.subtract(this._dragOffset);
                        this._draggedPiece.setPosition(newPosition.x, newPosition.y, this._draggedPiece.mesh.position.z);
                    }
                }
            }
        });
    }

    private _snapPiece(piece: PuzzlePiece): void {
        let snapped = false;
        const snapThreshold = this._puzzleWidth / this._cols / 2;

        const distToSelfCorrectPos = Vector3.Distance(
            new Vector3(piece.mesh.position.x, piece.mesh.position.y, 0),
            new Vector3(piece.originalPosition.x, piece.originalPosition.y, 0)
        );

        if (distToSelfCorrectPos < snapThreshold) {
            piece.snapToOriginalPosition();
            snapped = true;
        } else {
            for (const otherPiece of this._puzzlePieces) {
                if (otherPiece !== piece && otherPiece.isLocked) {
                    const currentPos = piece.mesh.position;
                    const tileWidth = this._puzzleWidth / this._cols;
                    const tileHeight = this._puzzleHeight / this._rows;
                    let idealSnapPosition: Vector3 | null = null;

                    if (piece.row === otherPiece.row - 1 && piece.col === otherPiece.col) {
                        idealSnapPosition = new Vector3(
                            otherPiece.originalPosition.x,
                            otherPiece.originalPosition.y + tileHeight,
                            this._pieceDepth / 2 + 0.01
                        );
                    } else if (piece.row === otherPiece.row + 1 && piece.col === otherPiece.col) {
                        idealSnapPosition = new Vector3(
                            otherPiece.originalPosition.x,
                            otherPiece.originalPosition.y - tileHeight,
                            this._pieceDepth / 2 + 0.01
                        );
                    } else if (piece.col === otherPiece.col - 1 && piece.row === otherPiece.row) {
                        idealSnapPosition = new Vector3(
                            otherPiece.originalPosition.x + tileWidth,
                            otherPiece.originalPosition.y,
                            this._pieceDepth / 2 + 0.01
                        );
                    } else if (piece.col === otherPiece.col + 1 && piece.row === otherPiece.row) {
                        idealSnapPosition = new Vector3(
                            otherPiece.originalPosition.x - tileWidth,
                            otherPiece.originalPosition.y,
                            this._pieceDepth / 2 + 0.01
                        );
                    }

                    if (idealSnapPosition) {
                        const distanceToNeighborSnap = Vector3.Distance(
                            new Vector3(currentPos.x, currentPos.y, 0),
                            new Vector3(idealSnapPosition.x, idealSnapPosition.y, 0)
                        );

                        if (distanceToNeighborSnap < snapThreshold) {
                            piece.setPosition(idealSnapPosition.x, idealSnapPosition.y, idealSnapPosition.z);
                            piece.lock();
                            snapped = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!snapped) {
            piece.setPosition(
                piece.currentPosition.x,
                piece.currentPosition.y,
                this._pieceDepth / 2 + 0.01
            );
        }
    }

    private _checkWinCondition(): void {
        const allPiecesAreLocked = this._puzzlePieces.every(piece => piece.isLocked);
        if (allPiecesAreLocked) {
            const allPiecesAreInCorrectPosition = this._puzzlePieces.every(piece =>
                piece.currentPosition.equalsWithEpsilon(
                    new Vector3(piece.originalPosition.x, piece.originalPosition.y, piece.originalPosition.z + this._pieceDepth / 2 + 0.01),
                    0.001
                )
            );

            if (allPiecesAreInCorrectPosition && !this._isGameSolved) {
                this._isGameSolved = true;
                this._messageDisplay.textContent = "Félicitations, vous avez résolu le puzzle !";
                this._disableInteractions();
                this._animateSolvedPuzzle();
            } else if (!allPiecesAreInCorrectPosition) {
                this._messageDisplay.textContent = "Oops ! Toutes les pièces sont verrouillées mais pas au bon endroit. Réessayez !";
                setTimeout(() => {
                    this.resetGame();
                }, 2000);
            }
        }
    }

    private _disableInteractions(): void {
        this._puzzlePieces.forEach(piece => {
            piece.mesh.isPickable = false;
        });
        if (this._xrExperience?.baseExperience.state !== WebXRState.IN_XR) {
            (this._scene.activeCamera as ArcRotateCamera)?.attachControl(this._canvas, true);
        }
    }

    private _animateSolvedPuzzle(): void {
        if (this._xrExperience?.baseExperience.state === WebXRState.IN_XR) {
            // Animation simplifiée pour VR
            this._puzzlePieces.forEach(piece => {
                if (piece.mesh.material instanceof StandardMaterial) {
                    const frameRate = 60;
                    const emissiveAnimation = new Animation("emissiveAnimation", "emissiveColor", frameRate, Animation.ANIMATIONTYPE_COLOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
                    const emissiveKeys = [
                        { frame: 0, value: Color3.Green() },
                        { frame: frameRate / 2, value: new Color3(0.1, 0.5, 0.1) },
                        { frame: frameRate, value: Color3.Green() }
                    ];
                    emissiveAnimation.setKeys(emissiveKeys);
                    this._scene.beginDirectAnimation(piece.mesh.material, [emissiveAnimation], 0, frameRate, true, 1.0);
                }
            });
        } else {
            const camera = this._scene.activeCamera as ArcRotateCamera;
            if (!camera) return;

            const frameRate = 60;
            const animationDuration = 3;

            const radiusAnimation = new Animation("radiusAnimation", "radius", frameRate, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
            const radiusKeys = [
                { frame: 0, value: camera.radius },
                { frame: animationDuration * frameRate, value: 1.2 * Math.max(this._puzzleWidth, this._puzzleHeight) }
            ];
            radiusAnimation.setKeys(radiusKeys);

            const alphaAnimation = new Animation("alphaAnimation", "alpha", frameRate, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
            const alphaKeys = [
                { frame: 0, value: camera.alpha },
                { frame: animationDuration * frameRate, value: camera.alpha + Math.PI / 4 }
            ];
            alphaAnimation.setKeys(alphaKeys);

            const targetAnimation = new Animation("targetAnimation", "target", frameRate, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CONSTANT);
            const targetKeys = [
                { frame: 0, value: camera.target.clone() },
                { frame: animationDuration * frameRate, value: Vector3.Zero() }
            ];
            targetAnimation.setKeys(targetKeys);

            this._scene.beginDirectAnimation(camera, [radiusAnimation, alphaAnimation, targetAnimation], 0, animationDuration * frameRate, false, 1);

            this._puzzlePieces.forEach(piece => {
                if (piece.mesh.material instanceof StandardMaterial) {
                    const emissiveAnimation = new Animation("emissiveAnimation", "emissiveColor", frameRate, Animation.ANIMATIONTYPE_COLOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
                    const emissiveKeys = [
                        { frame: 0, value: Color3.Green() },
                        { frame: frameRate / 2, value: new Color3(0.1, 0.5, 0.1) },
                        { frame: frameRate, value: Color3.Green() }
                    ];
                    emissiveAnimation.setKeys(emissiveKeys);
                    this._scene.beginDirectAnimation(piece.mesh.material, [emissiveAnimation], 0, frameRate, true, 1.0);
                }
            });
        }
    }

    public resetGame(): void {
        this._isGameSolved = false;
        this._messageDisplay.textContent = '';
        this._puzzlePieces.forEach(piece => {
            piece.reset();
            piece.mesh.isPickable = true;
            if (piece.mesh.material instanceof StandardMaterial) {
                this._scene.stopAnimation(piece.mesh.material);
            }
        });
        this._shufflePuzzle();
        if (this._xrExperience?.baseExperience.state !== WebXRState.IN_XR) {
            const camera = this._scene.activeCamera as ArcRotateCamera;
            if (camera) {
                camera.alpha = Math.PI / 2;
                camera.beta = Math.PI / 2.5;
                camera.radius = 10;
                camera.target = Vector3.Zero();
            }
        }
    }

    public run(): void {
        // Vide, mais peut être utilisé pour des initialisations supplémentaires si nécessaire
    }
}