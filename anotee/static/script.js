// #region GLOBAL VARIABLES
let canvas, ctx;
// Tool and Drawing State
let currentTool = 'select';
let isDrawing = false;
let startX, startY;
let selectedAnnotation = null;
let annotationIdCounter = 1;
// Multi-Image and Annotation Management
let loadedImages = [];
let allAnnotations = {}; // Keyed by image file name (full URL)
let annotations = []; // Annotations for the CURRENT image
let currentImageIndex = -1;
let loadedImage = null; // The current Image object
// Polygon/Polyline creation state
let polygonPoints = [];
let isCreatingPolygon = false;
let polylinePoints = [];
let isCreatingPolyline = false;
// History Management (per-image)
let history = {};
// Canvas Interaction
let isPanning = false;
let lastMousePos = { x: 0, y: 0 };
let scale = 1.0;
let originX = 0;
let originY = 0;
let isResizing = false;
let resizeHandle = null;
let isDraggingAnnotation = false;
let dragStartPos = { x: 0, y: 0 };
// Appearance & Display Settings
const colors = ["#E53935", "#3949AB", "#43A047", "#FB8C00", "#8E24AA", "#039BE5", "#FDD835", "#D81B60"];
let fillOpacity = 0.2;
let colorMode = 'instance';
// Image Filters
let imageFilters = { brightness: 100, contrast: 100 };
// Labels
let userLabels = [];
let selectedLabel = null;
// DOM Elements
let fileInput, searchInput, opacitySlider, brightnessSlider, contrastSlider, colorModeSelector, uploadArea;
let lastKnownMouseEvent = null;
let projectId = null;
// #endregion

// #region INITIALIZATION & DATA FLOW
document.addEventListener('DOMContentLoaded', () => {
    // Initialize DOM element references
    canvas = document.getElementById('imageCanvas');
    ctx = canvas.getContext('2d');
    fileInput = document.getElementById('fileInput');
    searchInput = document.getElementById('searchInput');
    opacitySlider = document.getElementById('opacitySlider');
    brightnessSlider = document.getElementById('brightnessSlider');
    contrastSlider = document.getElementById('contrastSlider');
    colorModeSelector = document.getElementById('colorModeSelector');
    uploadArea = document.getElementById('uploadArea');

    // Correctly get the project ID from the URL
    const urlParams = new URLSearchParams(window.location.search);
    projectId = urlParams.get('project_id');

    if (!projectId) {
        if (uploadArea) uploadArea.innerHTML = '<h1>Error: No Project ID was found. Please create a new task.</h1>';
        return;
    }
    
    // Set up the link for the review page
    const reviewLink = document.getElementById('reviewLink');
    if (reviewLink) reviewLink.href = `/review/?project_id=${projectId}`;

    setupEventListeners();
    loadProjectData();
});

async function loadProjectData() {
    try {
        const response = await fetch(`/api/project/${projectId}/`);
        const result = await response.json();
        if (result.success) {
            const data = result.data;
            userLabels = data.labels;
            allAnnotations = data.annotations || {};
            populateLabelsList();
            loadImagesFromUrls(data.images);
        } else {
            alert('Error loading project data: ' + result.error);
        }
    } catch (error) {
        console.error("Failed to fetch project data:", error);
    }
}

async function saveWorkToStorage() {
    if (!projectId) return alert("Cannot save: No project ID is set.");
    if (currentImageIndex !== -1) {
        allAnnotations[loadedImages[currentImageIndex].file.name] = annotations;
    }
    
    try {
        const response = await fetch(`/api/project/${projectId}/save/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ annotations: allAnnotations })
        });
        const result = await response.json();
        if (result.success) {
            alert("Progress saved successfully to the server!");
        } else {
            alert("Error saving progress: " + result.error);
        }
    } catch (error) {
        console.error("Failed to save annotations:", error);
    }
}
// #endregion

// #region EVENT LISTENERS
function setupEventListeners() {
    const magicWandButton = document.getElementById('magicWandButton');
    if (magicWandButton) magicWandButton.addEventListener('click', runObjectDetection);

    document.querySelectorAll('.tool-button').forEach(button => {
        button.addEventListener('click', () => {
            const tool = button.getAttribute('data-tool');
            if (tool && !button.onclick && tool !== 'magic') {
                if (document.querySelector('.tool-button.active')) {
                    document.querySelector('.tool-button.active').classList.remove('active');
                }
                button.classList.add('active');
                currentTool = tool;
                isCreatingPolygon = isCreatingPolyline = false;
                polygonPoints = []; polylinePoints = [];
                selectedAnnotation = null;
                updateCursor();
                redrawCanvas();
                toggleDrawingHint(false);
            }
        });
    });

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    
    if(fileInput) fileInput.addEventListener('change', (e) => processImageFiles(Array.from(e.target.files)));
    if(searchInput) searchInput.addEventListener('input', filterAnnotations);
    
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', () => { if(loadedImage) displayImage(currentImageIndex); });
    
    const exportOptions = document.querySelectorAll('.export-option');
    if (exportOptions) {
        exportOptions.forEach(option => {
            option.addEventListener('click', () => exportAnnotations(option.dataset.format));
        });
    }
}
// #endregion

// #region IMAGE AND LABEL LOADING
function populateLabelsList() {
    const labelsList = document.getElementById('labelsList');
    if (!labelsList) return;
    if (userLabels.length === 0) {
        labelsList.innerHTML = "<p class='no-labels-message'>No labels defined.</p>";
        return;
    }
    labelsList.innerHTML = '';
    userLabels.forEach((label, index) => {
        const item = document.createElement('div');
        item.className = 'label-item';
        item.textContent = label;
        item.onclick = () => {
            const currentActive = document.querySelector('.label-item.active');
            if (currentActive) currentActive.classList.remove('active');
            item.classList.add('active');
            selectedLabel = label;
        };
        labelsList.appendChild(item);
        if (index === 0) item.click();
    });
}

async function loadImagesFromUrls(urls) {
    updateFrameCounter(`Loading ${urls.length} images...`);
    try {
        const imagePromises = urls.map(url => new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => resolve({ img, file: { name: url } });
            img.onerror = () => reject(new Error(`Failed to load: ${url}`));
            img.src = url;
        }));
        const newImages = await Promise.all(imagePromises);
        processLoadedImages(newImages);
    } catch (error) {
        console.error(error);
        alert(error.message);
    }
}

function processImageFiles(files) {
    if (!files || files.length === 0) return;
    const fileLoadPromises = files.map(file => new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => resolve({ img, file });
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    }));
    Promise.all(fileLoadPromises).then(newImages => {
        processLoadedImages(newImages.filter(Boolean));
    });
}

function processLoadedImages(newImages) {
    const wasEmpty = loadedImages.length === 0;
    loadedImages = loadedImages.concat(newImages);
    newImages.forEach(imgData => {
        const key = imgData.file.name;
        if (!allAnnotations[key]) allAnnotations[key] = [];
        if (!history[key]) history[key] = { states: [[]], step: -1 };
    });
    if (uploadArea) uploadArea.style.display = 'none';
    if (wasEmpty && loadedImages.length > 0) {
        displayImage(0);
    }
    updateFrameCounter();
}
// #endregion

// #region AI - YOLOv8 MAGIC WAND
async function runObjectDetection() {
    if (!loadedImage) return alert("Please load an image first.");
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    const formData = new FormData();
    formData.append('imageUrl', loadedImages[currentImageIndex].file.name);
    try {
        const response = await fetch('/api/detect/', { method: 'POST', body: formData, headers: {'X-CSRFToken': getCookie('csrftoken')} });
        const data = await response.json();
        if (data.success) {
            let addedCount = 0;
            data.detections.forEach(det => {
                if (userLabels.includes(det.label)) {
                    annotations.push(createNewAnnotation({
                        label: det.label, x: det.x, y: det.y,
                        width: det.width, height: det.height,
                        type: 'rectangle',
                    }));
                    addedCount++;
                }
            });
            alert(`YOLOv8 detected ${data.detections.length} objects. Added ${addedCount} matching your defined labels.`);
            updateAndSave();
        } else {
            alert("Object detection failed: " + data.error);
        }
    } catch (error) {
        console.error("Error calling AI backend:", error);
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}
// #endregion

// #region IMAGE & CANVAS HANDLING
function displayImage(index) {
    if (index < 0 || index >= loadedImages.length) return;
    if (currentImageIndex !== -1) allAnnotations[loadedImages[currentImageIndex].file.name] = annotations;
    currentImageIndex = index;
    const imgData = loadedImages[currentImageIndex];
    loadedImage = imgData.img;
    annotations = allAnnotations[imgData.file.name];
    const container = canvas.parentElement;
    const ratio = Math.min(container.clientWidth / loadedImage.width, container.clientHeight / loadedImage.height, 1) * 0.98;
    scale = ratio;
    originX = (container.clientWidth - loadedImage.width * scale) / 2;
    originY = (container.clientHeight - loadedImage.height * scale) / 2;
    updateFrameCounter();
    updateAnnotationsList();
    redrawCanvas();
    if (history[imgData.file.name].step < 0) saveState();
}
function redrawCanvas() {
    if (!canvas || !ctx) return;
    const container = canvas.parentElement;
    canvas.width = container.clientWidth; canvas.height = container.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!loadedImage) return;

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);
    ctx.drawImage(loadedImage, 0, 0);
    redrawAnnotations();
    if (isDrawing) {
        const lastMouse = getMousePos(lastKnownMouseEvent);
        drawShapePreview(lastMouse);
    }
    ctx.restore();
}
function onWheel(e) { /* ... same as your working file ... */ }
// #endregion

// #region MOUSE HANDLERS
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left - originX) / scale, y: (e.clientY - rect.top - originY) / scale };
}
function onMouseDown(e) {
    if (e.button !== 0 || !loadedImage) return;
    const pos = getMousePos(e);
    startX = pos.x; startY = pos.y;
    lastMousePos = { x: e.clientX, y: e.clientY };
    if (currentTool === 'move') { isPanning = true; canvas.style.cursor = 'grabbing'; return; }
    if (currentTool === 'select') {
        selectedAnnotation = getAnnotationAtPoint(pos);
        if (selectedAnnotation) {
            isDraggingAnnotation = true;
            dragStartPos = pos;
        }
        redrawCanvas();
    } else if (['rectangle', 'polygon'].includes(currentTool)) {
        if (!selectedLabel) return alert("Please select a label first!");
        if (currentTool === 'rectangle') isDrawing = true;
        if (currentTool === 'polygon') handlePolygonClick(pos);
    }
}
function onMouseMove(e) {
    lastKnownMouseEvent = e;
    if (isPanning) {
        originX += e.clientX - lastMousePos.x;
        originY += e.clientY - lastMousePos.y;
        lastMousePos = { x: e.clientX, y: e.clientY };
        redrawCanvas();
        return;
    }
    if (!loadedImage) return;
    if (isDraggingAnnotation && selectedAnnotation) { moveAnnotation(getMousePos(e)); redrawCanvas(); } 
    else if (isDrawing) { redrawCanvas(); }
}
function onMouseUp(e) {
    if (isPanning) isPanning = false;
    if (isDrawing) {
        isDrawing = false;
        createShapeAnnotation(getMousePos(e));
    }
    if (isDraggingAnnotation) {
        isDraggingAnnotation = false;
        saveState();
    }
    redrawCanvas();
}
function onDoubleClick(e) { /* Stub */ }
// #endregion

// #region ANNOTATION LOGIC
function createNewAnnotation(properties) {
    const label = properties.label || selectedLabel || 'unlabeled';
    const classId = userLabels.indexOf(label);
    const base = {
        id: annotationIdCounter++,
        label: label,
        classId: classId > -1 ? classId : -1,
        type: properties.type || currentTool,
    };
    const newAnn = { ...base, ...properties };
    newAnn.color = getColorForAnnotation(newAnn);
    return newAnn;
}
function createShapeAnnotation(endPos) {
    const width = Math.abs(endPos.x - startX);
    const height = Math.abs(endPos.y - startY);
    if (width < 5 || height < 5) { return; }
    const newAnn = createNewAnnotation({
        x: Math.min(startX, endPos.x), y: Math.min(startY, endPos.y),
        width: width, height: height,
        type: 'rectangle'
    });
    annotations.push(newAnn);
    selectedAnnotation = newAnn;
    updateAndSave();
}
function moveAnnotation(currentPos) {
    if (!selectedAnnotation || !isDraggingAnnotation) return;
    const dx = currentPos.x - dragStartPos.x;
    const dy = currentPos.y - dragStartPos.y;
    selectedAnnotation.x += dx;
    selectedAnnotation.y += dy;
    dragStartPos = currentPos;
}
function deleteAnnotation(id) {
    const index = annotations.findIndex(a => a.id === id);
    if (index > -1) {
        annotations.splice(index, 1);
        if (selectedAnnotation && selectedAnnotation.id === id) selectedAnnotation = null;
        updateAndSave();
    }
}
// #endregion

// #region DRAWING & INTERACTION
function redrawAnnotations() {
    annotations.forEach(ann => {
        drawAnnotation(ann);
    });
}
function drawAnnotation(ann) {
    const color = (selectedAnnotation && ann.id === selectedAnnotation.id) ? 'yellow' : (ann.color || 'lime');
    const rgb = hexToRgb(color);
    ctx.strokeStyle = color;
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${fillOpacity})`;
    ctx.lineWidth = (selectedAnnotation && ann.id === selectedAnnotation.id) ? 3 / scale : 2 / scale;
    ctx.beginPath();
    ctx.rect(ann.x, ann.y, ann.width, ann.height);
    ctx.fill();
    ctx.stroke();
    const box = getBoundingBox(ann);
    if (box) {
        ctx.fillStyle = color;
        ctx.font = `${14/scale}px sans-serif`;
        ctx.fillText(ann.label, box.x, box.y > 20 ? box.y - (5/scale) : box.y + box.height + (15/scale));
    }
}
function drawShapePreview(endPos) {
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(startX, startY, endPos.x - startX, endPos.y - startY);
    ctx.restore();
}
function getAnnotationAtPoint(pos) {
    for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        if (pos.x >= ann.x && pos.x <= ann.x + ann.width && pos.y >= ann.y && pos.y <= ann.y + ann.height) {
            return ann;
        }
    }
    return null;
}
// #endregion

// #region HISTORY, STORAGE, UI, EXPORT
function updateAndSave() {
    if (loadedImage) allAnnotations[loadedImages[currentImageIndex].file.name] = annotations;
    updateAnnotationsList();
    redrawCanvas();
    saveState();
}
function saveState() {
    if (!loadedImage) return;
    const key = loadedImages[currentImageIndex].file.name;
    if (!history[key]) history[key] = { states: [], step: -1 };
    const imgHistory = history[key];
    // Push a deep copy of the current state
    imgHistory.states.push(JSON.parse(JSON.stringify(annotations)));
    imgHistory.step = imgHistory.states.length - 1;
}
function undo() {
    if (!loadedImage) return;
    const imgHistory = history[loadedImages[currentImageIndex].file.name];
    if (imgHistory && imgHistory.step > 0) {
        imgHistory.step--;
        loadState(imgHistory);
    }
}
function redo() {
    if (!loadedImage) return;
    const imgHistory = history[loadedImages[currentImageIndex].file.name];
    if (imgHistory && imgHistory.step < imgHistory.states.length - 1) {
        imgHistory.step++;
        loadState(imgHistory);
    }
}
function loadState(imgHistory) {
    if (!imgHistory.states[imgHistory.step]) return;
    annotations = JSON.parse(JSON.stringify(imgHistory.states[imgHistory.step]));
    allAnnotations[loadedImages[currentImageIndex].file.name] = annotations;
    selectedAnnotation = null;
    updateAnnotationsList();
    redrawCanvas();
}
function updateAnnotationsList() {
    const list = document.getElementById('annotationsList');
    if (!list) return;
    list.innerHTML = '';
    annotations.forEach(ann => {
        const item = document.createElement('div');
        item.className = 'annotation-item';
        if (selectedAnnotation && selectedAnnotation.id === ann.id) item.classList.add('active');
        item.innerHTML = `<span>${ann.label}</span> <button class="delete-btn" onclick="deleteAnnotation(${ann.id})">×</button>`;
        item.onclick = () => {
            selectedAnnotation = ann;
            redrawCanvas();
            updateAnnotationsList();
        };
        list.appendChild(item);
    });
}
function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else if (document.exitFullscreen) document.exitFullscreen();
}
function showInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) modal.style.display = 'flex';
}
function closeInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) modal.style.display = 'none';
}
function updateFrameCounter(text) {
    const counter = document.getElementById('frameCounter');
    if (counter) counter.textContent = text || (loadedImages.length > 0 ? `Frame: ${currentImageIndex + 1} / ${loadedImages.length}` : 'No Images');
}
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
function hexToRgb(hex) {
    if (!hex) return {r:204, g:204, b:204};
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : {r:204, g:204, b:204};
}
function getColorForAnnotation(ann) {
    if (ann.classId > -1 && ann.classId < colors.length) {
        return colors[ann.classId];
    }
    return "#CCCCCC";
}
function getBoundingBox(ann) {
    if (ann.type === 'rectangle' || ann.type === 'circle') {
        return { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
    }
    return null;
}
function handleKeyDown(e) {
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    switch(e.key) {
        case "ArrowRight": displayImage(currentImageIndex + 1); break;
        case "ArrowLeft": displayImage(currentImageIndex - 1); break;
        case "Delete": case "Backspace": if (selectedAnnotation) { deleteAnnotation(selectedAnnotation.id); } break;
    }
}
function toggleDrawingHint() { /* Stub - can be implemented if needed */ }
function filterAnnotations() { updateAnnotationsList(); }
// #endregion