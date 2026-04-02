# This is a mock database of user profile data.
# In a real application, you might fetch this from a database based on an authenticated user.

USER_PROFILE = {
    "first_name": "Nikhil",
    "last_name": "Murugesan",
    "full_name": "Nikhil Murugesan",
    "date_of_birth": "30/11/1999",

    "email": "mmmm.nikhil@gmail.com",
    "phone": "+91-9597917991",

    "address_line1": "S1, V3 Flats, Plot No 13A Aadhi kesava Thillai Nagar Mugilivakkam",
    "address_line2": "",
    "landmark": "Opposite Beyond Automotive, RGR Builders Blue Building",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "zip_code": "600125",
    "country": "India",

    "job_title": "Backend Engineer",
    "current_company": "United Parcel Service (UPS)",
    "years_of_experience": 4,

    "skills": [
        # Core Programming
        "Python", "Java", "SQL", "TypeScript",

        # Backend & Architecture
        "Spring Boot", "Microservices", "REST APIs",
        "System Design", "Distributed Systems", 

        # Frontend
        "Angular", "RxJS",

        # Data Engineering
        "Data Pipelines", "ETL", "Data Processing",
        "Pandas", "NumPy", "Feature Engineering",

        # Databases
        "Oracle", "MongoDB", "Redis", "Caching",

        # DevOps & Cloud
        "Docker", "CI/CD", "OpenShift", "TeamCity", "UrbanCode",

        # Machine Learning
        "Machine Learning", "Supervised Learning", "Model Training",
        "Scikit-learn", "Model Evaluation", "Model Deployment",

        # NLP & Transformers
        "Natural Language Processing", "NLP",
        "RoBERTa", "BERT", "Transformers",
        "Hugging Face", "Tokenization", "Text Classification",

        # LLM & Generative AI
        "Large Language Models (LLMs)",
        "Prompt Engineering",
        "Fine-tuning LLMs",
        "RAG (Retrieval-Augmented Generation)",
        "Embeddings", "Vector Databases",
        "Semantic Search",

        # Agent AI
        "AI Agents", "Agentic Workflows",
        "Multi-Agent Systems",
        "Tool Calling", "Function Calling",
        "Autonomous Agents",

        # Frameworks & Tools
        "LangChain", "LlamaIndex",
        "OpenAI API", "Hugging Face Inference API",

        # Advanced AI Concepts
        "Deep Learning", "Neural Networks",
        "Anomaly Detection", "Forecasting Models",

        # MLOps
        "ML Pipelines", "Model Versioning",
        "Experiment Tracking", "Model Monitoring"
    ],

    "linkedin": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",  
    "github": "https://github.com/NikhilMurugesan",
    "website" : "https://nikhilmurugesan.in",    

    "role_preference": "backend_ai_ml",
    "career_focus": "AI/ML Backend Engineering",
}

def get_user_data() -> dict:
    """Retrieves the user profile data."""
    return USER_PROFILE
