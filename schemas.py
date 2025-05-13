"""
Modelos de datos para la generación de planes estructurados
"""
from typing import List
from pydantic import BaseModel, Field

class PlanStep(BaseModel):
    """Modelo que representa un paso del plan con su número, título y descripción"""
    numero: int = Field(description="Número de orden del paso")
    titulo: str = Field(description="Título corto y descriptivo para el paso")
    descripcion: str = Field(description="Descripción detallada del paso, incluyendo comandos a ejecutar")

class Plan(BaseModel):
    """Modelo que representa un plan completo con lista de pasos"""
    pasos: List[PlanStep] = Field(description="Lista de pasos ordenados del plan")
