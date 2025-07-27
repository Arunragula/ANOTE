from django.contrib import admin
from django.urls import path
from anotee import views
from django.contrib.auth import views as auth_views


urlpatterns = [
    path('admin/', admin.site.urls),
    path('', views.landing, name='landing'),
    path('about/', views.about, name='about'),
    path('contact/', views.contact, name='contact'),
    path('services/', views.services, name='services'),
    path('resources/', views.resources, name='resources'),
    path('footer/', views.footer, name='footer'),
    path('navbar/', views.navbar, name='navbar'),
    path('base/', views.base, name='base'),
    path('register/', views.register_view, name='register'),
    path('login/', auth_views.LoginView.as_view(template_name='login.html'), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('tasks/', views.tasks, name='tasks'),
    path('create_task/', views.create_task, name='create_task'),
    path('normal/', views.normal, name='normal'),
    path('review/', views.review, name='review'),
    path('api/project/<str:project_id>/', views.get_project_data, name='get_project_data'),
    path('api/project/<str:project_id>/save/', views.save_annotations, name='save_annotations'),
    path('api/detect/', views.detect_objects, name='detect_objects'),


]