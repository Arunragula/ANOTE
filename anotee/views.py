from django.shortcuts import render, redirect 
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth import authenticate, login
from django.contrib.auth.models import User
from .models import Profile
from django.contrib import messages

# Create your views here.
def landing(request):
    return render(request, 'landing.html')

def about(request):
    return render(request, 'about.html')

def contact(request):
    return render(request, 'contact.html')  

def services(request):
    return render(request, 'services.html')

def resources(request):
    return render(request, 'resources.html')

def footer(request):
    return render(request, 'footer.html')

def navbar(request):
    return render(request, 'navbar.html')

def base(request):
    return render(request, 'base.html')

def login_view(request):
    if request.user.is_authenticated:
        return redirect('tasks')  # Already logged in, redirect directly

    if request.method == 'POST':
        form = AuthenticationForm(data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            return redirect('tasks')
        else:
            messages.error(request, 'Invalid username or password.')
    else:
        form = AuthenticationForm()

    return render(request, 'login.html', {'form': form})

def register_view(request):
    if request.method == 'POST':
        # Get data from the form
        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip()
        first_name = request.POST.get('first_name', '').strip()
        last_name = request.POST.get('last_name', '').strip()
        phone = request.POST.get('phone', '').strip()
        password1 = request.POST.get('password1', '')
        password2 = request.POST.get('password2', '')
        newsletter = request.POST.get('newsletter') == 'on'
        
        # Validation
        errors = []
        
        if not username:
            errors.append("Username is required.")
        elif User.objects.filter(username=username).exists():
            errors.append("Username already exists.")
            
        if not email:
            errors.append("Email is required.")
        elif User.objects.filter(email=email).exists():
            errors.append("Email already exists.")
            
        if not first_name:
            errors.append("First name is required.")
            
        if not last_name:
            errors.append("Last name is required.")
            
        if not password1:
            errors.append("Password is required.")
        elif len(password1) < 8:
            errors.append("Password must be at least 8 characters long.")
            
        if password1 != password2:
            errors.append("Passwords do not match.")
        
        # If there are errors, show them
        if errors:
            for error in errors:
                messages.error(request, error)
            return render(request, 'register.html')
        
        try:
            # Create the User
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password1,
                first_name=first_name,
                last_name=last_name
            )
            
            # Create the Profile using your models.py
            full_name = f"{first_name} {last_name}"
            Profile.objects.create(
                user=user,
                full_name=full_name,
                phone=phone,
                newsletter=newsletter
            )
            
            messages.success(request, 'Account created successfully! Please log in.')
            return redirect('login')  # Redirect to login page
            
        except Exception as e:
            messages.error(request, f'Error creating account: {str(e)}')
            return render(request, 'register.html')
    
    # For GET request, show empty form
    return render(request, 'register.html')

from django.contrib.auth.decorators import login_required
#tasks
@login_required
def tasks(request):
    return render(request, 'tasks.html')





from django.http import JsonResponse
from django.core.files.storage import FileSystemStorage
from django.views.decorators.csrf import csrf_exempt
import os
import json
import uuid # For creating unique project IDs
from django.conf import settings
from ultralytics import YOLO

# --- Model Loading ---
print("Loading YOLOv8 model...")
yolo_model = YOLO('yolov8n.pt') 
print("YOLOv8 model loaded successfully.")

# --- Main Views ---

def create_task(request):
    """
    Handles the initial label definition and file uploads.
    Creates a new "project" in the user's session.
    """
    if request.method == 'POST':
        try:
            files = request.FILES.getlist('uploaded_files')
            labels = request.POST.get('labels', '[]') # Labels are now sent in the request body
            
            if not files:
                return JsonResponse({'success': False, 'error': 'No files were uploaded.'})

            fs = FileSystemStorage()
            saved_file_urls = [fs.url(fs.save(f.name, f)) for f in files]
            
            # Create a unique ID for this project
            project_id = str(uuid.uuid4())
            
            # Initialize the session if it doesn't exist
            if 'projects' not in request.session:
                request.session['projects'] = {}
            
            # Store all project data in the session under the unique ID
            request.session['projects'][project_id] = {
                'id': project_id,
                'labels': json.loads(labels),
                'images': saved_file_urls,
                'annotations': {} # Initialize an empty dictionary for annotations
            }
            request.session.modified = True

            return JsonResponse({'success': True, 'project_id': project_id})
            
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return render(request, 'create_task.html')

def normal(request):
    """
    Renders the main annotation tool. The project_id will be in the URL.
    """
    return render(request, 'normal.html')

def review(request):
    """
    Renders the new review and download page.
    """
    return render(request, 'review.html')

# --- API Endpoints for JavaScript ---

@csrf_exempt
def get_project_data(request, project_id):
    """
    API endpoint for the frontend to fetch all data for a specific project.
    """
    project_data = request.session.get('projects', {}).get(project_id)
    if project_data:
        return JsonResponse({'success': True, 'data': project_data})
    return JsonResponse({'success': False, 'error': 'Project not found.'}, status=404)

@csrf_exempt
def save_annotations(request, project_id):
    """
    API endpoint for the frontend to save its annotation progress.
    """
    if request.method == 'POST':
        try:
            projects = request.session.get('projects', {})
            if project_id in projects:
                # Get annotations from the request body
                new_annotations = json.loads(request.body).get('annotations', {})
                projects[project_id]['annotations'] = new_annotations
                request.session['projects'] = projects
                request.session.modified = True
                return JsonResponse({'success': True, 'message': 'Annotations saved.'})
            return JsonResponse({'success': False, 'error': 'Project not found.'}, status=404)
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)
    return JsonResponse({'success': False, 'error': 'Invalid request method.'})


@csrf_exempt
def detect_objects(request):
    """
    AI Backend View: Runs YOLOv8 on an uploaded image.
    """
    if request.method == 'POST':
        image_url = request.POST.get('imageUrl')
        if not image_url:
            return JsonResponse({'success': False, 'error': 'No image URL provided.'})
        try:
            if image_url.startswith(settings.MEDIA_URL):
                relative_path = image_url[len(settings.MEDIA_URL):]
                image_path = os.path.join(settings.MEDIA_ROOT, relative_path)
            else:
                return JsonResponse({'success': False, 'error': 'Invalid image URL format.'})
            if not os.path.exists(image_path):
                 return JsonResponse({'success': False, 'error': 'Image file not found.'})

            results = yolo_model(image_path)
            detections = []
            for box in results[0].boxes:
                coords = box.xyxy[0].tolist()
                class_id = int(box.cls[0])
                class_name = yolo_model.names[class_id]
                confidence = float(box.conf[0])
                if confidence > 0.4:
                    detections.append({
                        'label': class_name, 'x': coords[0], 'y': coords[1],
                        'width': coords[2] - coords[0], 'height': coords[3] - coords[1]
                    })
            return JsonResponse({'success': True, 'detections': detections})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)})
    return JsonResponse({'success': False, 'error': 'POST requests only.'})