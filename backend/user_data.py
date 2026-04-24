"""Default user profile used by the autofill backend.

Keep personal overrides in ``backend/user_data_personal.py`` locally if needed.
That file is ignored by git and will override this default automatically.
"""

from copy import deepcopy


DEFAULT_USER_PROFILE = {
    "personal_info": {
        "full_name": "Nikhil Murugesan",
        "first_name": "Nikhil",
        "last_name": "Murugesan",
        "email": "mmmm.nikhil@gmail.com",
        "phone": "+91 9597917991",
        "location": {
            "city": "Chennai",
            "state": "Tamil Nadu",
            "country": "India",
            "full_location": "Chennai, India",
        },
        "headline": "Aspiring AI/ML Engineer | NLP, RAG, Agentic AI, Feature Engineering | Python, SQL, AWS, GCP",
        "summary": (
            "Result-driven technical professional with nearly 4 years of experience building distributed systems, "
            "microservices, data pipelines, and operational analytics workflows. Transitioning into AI/ML engineering "
            "with hands-on exposure to NLP, RoBERTa, Transformers, feature engineering, anomaly detection, model "
            "serving, RAG, and agentic AI systems."
        ),
        "linkedin_url": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",
        "portfolio_url": "https://nikhilmurugesan.in/",
        "website_url": "https://nikhilmurugesan.in/",
        "github_url": "https://github.com/NikhilMurugesan",
        "current_title": "Application Developer",
        "current_company": "United Parcel Service (UPS)",
        "open_to_work": True,
        "employment_type_preference": "Full-time",
        "work_authorization": "Indian Citizen",
        "date_of_birth": "1999-11-30",
        "languages_known": ["English", "Tamil"],
    },
    "professional_profile": {
        "primary_role": "AI/ML Engineer",
        "secondary_roles": [
            "Machine Learning Engineer",
            "NLP Engineer",
            "Backend Engineer",
            "Data Pipeline Engineer",
        ],
        "total_years_experience": 4,
        "domains": [
            "Artificial Intelligence",
            "Machine Learning",
            "Natural Language Processing",
            "Retrieval-Augmented Generation",
            "Agentic AI",
            "Feature Engineering",
            "Model Serving and Deployment",
            "Anomaly Detection",
            "Data Pipelines",
            "Microservices",
            "Distributed Systems",
            "Logistics",
        ],
    },
    "skills": {
        "top_skills": [
            "Machine Learning",
            "Natural Language Processing",
            "Feature Engineering",
            "Model Serving",
            "Data Pipeline Engineering",
            "Retrieval-Augmented Generation (RAG)",
            "Microservices Architecture",
        ],
        "programming_languages": ["Python", "Java", "SQL", "TypeScript"],
        "frameworks": [
            "Spring Boot",
            "Spring Cloud",
            "FastAPI",
            "Angular",
            "Scikit-learn",
            "Hugging Face Transformers",
        ],
        "ai_ml": [
            "Machine Learning",
            "Deep Learning",
            "NLP",
            "Transformer Models",
            "RoBERTa",
            "Sentiment Analysis",
            "Anomaly Detection",
            "Predictive Modeling",
            "Random Forest",
            "XGBoost",
            "Feature Engineering",
            "Model Training",
            "Model Evaluation",
            "Model Serving",
            "Model Deployment",
            "LLM Integration",
            "Agentic AI",
            "Retrieval-Augmented Generation",
        ],
        "data_tools": [
            "Pandas",
            "NumPy",
            "Data Pipelines",
            "ETL Pipeline Engineering",
            "Data Analytics",
            "Dashboarding",
        ],
        "cloud_devops": ["AWS", "GCP", "Docker", "CI/CD", "OpenShift"],
        "databases": ["SQL", "Oracle", "Sybase", "MySQL", "MongoDB", "Redis"],
        "architecture": [
            "Microservices",
            "REST APIs",
            "Event-Driven Systems",
            "Cloud-Native Architectures",
            "Distributed Systems",
            "System Design",
            "Performance Optimization",
        ],
        "tools": ["Black Duck", "GEM", "SonarQube"],
        "soft_skills": [
            "Problem-solving",
            "Analytical Thinking",
            "Teamwork",
            "Process Optimization",
        ],
    },
    "experience": [
        {
            "company": "United Parcel Service (UPS)",
            "title": "Application Developer",
            "employment_type": "Full-time",
            "location": "Chennai, India",
            "start_date": "2024-06",
            "end_date": "Present",
            "is_current": True,
            "description": "Builds data, backend, and ML-enabled workflows for logistics operations and analytics.",
            "achievements": [
                "Applied anomaly detection techniques to shipment data, reducing manual escalations by 25%.",
                "Built data pipelines for real-time warehouse tracking, SLA monitoring, and downstream analytics.",
                "Integrated data workflows with dashboards for KPI and performance tracking.",
                "Optimized queries and indexing, reducing data retrieval latency by 35%.",
                "Served sentiment prediction outputs through REST APIs for analytics consumption.",
                "Built and deployed a RoBERTa-based NLP pipeline on 10K+ reviews, achieving 89% sentiment classification accuracy.",
            ],
            "technologies": [
                "Python",
                "Java",
                "SQL",
                "Spring Boot",
                "REST APIs",
                "RoBERTa",
                "Hugging Face Transformers",
                "Data Pipelines",
                "Oracle",
                "Angular",
            ],
        },
        {
            "company": "Virtusa Corporation",
            "title": "Full Stack Developer",
            "employment_type": "Full-time",
            "location": "Chennai, Tamil Nadu, India",
            "start_date": "2022-06",
            "end_date": "2024-06",
            "is_current": False,
            "description": "Worked on enterprise application modernization, microservices migration, database performance, and deployment workflows.",
            "achievements": [
                "Optimized data access and query performance across Oracle and Sybase systems, improving retrieval latency by 30%.",
                "Streamlined CI/CD workflows across microservices environments, reducing deployment downtime by 20%.",
                "Migrated legacy modules to microservices architecture, improving system performance by 40%.",
                "Modernized application screens and services using Angular, Spring Boot, Java, and SQL.",
                "Improved code quality and security posture by resolving SonarQube, Black Duck, and GEM findings.",
            ],
            "technologies": [
                "Java",
                "Spring Boot",
                "Angular",
                "SQL",
                "Oracle",
                "Sybase",
                "CI/CD",
                "SonarQube",
                "Black Duck",
                "GEM",
            ],
        },
    ],
    "education": [
        {
            "institution": "Vellore Institute of Technology, Bhopal",
            "degree": "B.Tech.",
            "field_of_study": "Computer Science & Engineering",
            "start_year": 2018,
            "end_year": 2022,
            "cgpa": "7.92",
        },
    ],
    "projects": [
        {
            "name": "RoBERTa Sentiment Analysis Pipeline",
            "category": "AI/ML",
            "description": (
                "Built and deployed an NLP pipeline using RoBERTa and Transformers to classify 10K+ reviews, "
                "achieving 89% sentiment classification accuracy and delivering structured customer insights."
            ),
            "technologies": ["Python", "RoBERTa", "Hugging Face Transformers", "NLP", "REST APIs"],
        },
        {
            "name": "Shipment Delay Prediction Model",
            "category": "Machine Learning",
            "description": (
                "Developing a classification model to predict shipment delays from historical logistics data using "
                "Random Forest and XGBoost, with feature engineering for temporal patterns, route-level aggregates, "
                "and volume trends."
            ),
            "technologies": [
                "Python",
                "Pandas",
                "NumPy",
                "Scikit-learn",
                "Random Forest",
                "XGBoost",
                "Feature Engineering",
            ],
        },
        {
            "name": "Log Anomaly Detection System",
            "category": "Machine Learning",
            "description": (
                "Conceptualized an anomaly detection system to identify irregular patterns in application logs and "
                "API response times, with planned integration into Spring Boot microservices for automated alerts."
            ),
            "technologies": ["Python", "Statistical Methods", "Anomaly Detection", "Spring Boot", "Microservices"],
        },
        {
            "name": "AI Job Search Copilot",
            "category": "LLM Application",
            "description": "Built an AI job search copilot with FastAPI and LLM integration for job-search workflow automation.",
            "technologies": ["FastAPI", "Python", "LLM Integration", "RAG"],
        },
    ],
    "cover_letter": {
        "target_role": "AI/ML Engineer",
        "opening": (
            "I am writing to express my interest in AI/ML engineering opportunities where I can apply nearly "
            "4 years of technical development experience and my growing expertise in machine learning, NLP, "
            "feature engineering, and data-driven systems."
        ),
        "body": (
            "In my current role at United Parcel Service, I have applied anomaly detection to shipment data, "
            "built real-time data pipelines, optimized query performance by 35%, and served ML-driven prediction "
            "outputs through APIs for analytics consumption. I also built a RoBERTa-based sentiment analysis "
            "pipeline on 10K+ reviews, achieving 89% classification accuracy."
        ),
        "ai_ml_focus": (
            "My AI/ML work includes NLP, Transformers, Scikit-learn, Pandas, NumPy, Random Forest, XGBoost, "
            "feature engineering, model serving, RAG, and agentic AI exposure. I am especially interested in "
            "building intelligent systems that solve real-world problems at scale."
        ),
        "closing": (
            "I would welcome the opportunity to discuss how my backend, data pipeline, and AI/ML experience can "
            "support your organization's machine learning and intelligent systems initiatives."
        ),
        "recruiter_message_200_chars": (
            "Hi, I am Nikhil, an aspiring AI/ML Engineer with nearly 4 years in backend systems, data pipelines, "
            "NLP, anomaly detection, RAG and model serving. Open to AI/ML roles ready to contribute at scale now."
        ),
    },
    "links": {
        "linkedin": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",
        "portfolio": "https://nikhilmurugesan.in/",
        "website": "https://nikhilmurugesan.in/",
        "github": "https://github.com/NikhilMurugesan",
    },
    "job_preferences": {
        "target_roles": [
            "AI/ML Engineer",
            "Machine Learning Engineer",
            "NLP Engineer",
            "Applied AI Engineer",
            "ML Backend Engineer",
            "Data Pipeline Engineer",
        ],
        "preferred_employment_type": "Full-time",
        "open_to_opportunities": True,
        "preferred_locations": ["Chennai", "Coimbatore", "Bangalore", "Hyderabad", "Remote"],
        "remote_preference": "Hybrid or Remote",
    },
    "autofill_fields": {
        "name": "Nikhil Murugesan",
        "full_name": "Nikhil Murugesan",
        "first_name": "Nikhil",
        "last_name": "Murugesan",
        "email": "mmmm.nikhil@gmail.com",
        "phone": "+91 9597917991",
        "current_company": "United Parcel Service (UPS)",
        "current_title": "Application Developer",
        "desired_title": "AI/ML Engineer",
        "location": "Chennai, India",
        "city": "Chennai",
        "state": "Tamil Nadu",
        "country": "India",
        "linkedin": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",
        "portfolio": "https://nikhilmurugesan.in/",
        "website": "https://nikhilmurugesan.in/",
        "github": "https://github.com/NikhilMurugesan",
        "highest_degree": "B.Tech.",
        "school": "Vellore Institute of Technology, Bhopal",
        "major": "Computer Science & Engineering",
        "cgpa": "7.92",
        "date_of_birth": "1999-11-30",
        "languages_known": "English, Tamil",
        "years_of_experience": "Nearly 4 years",
        "skills": (
            "Python, Java, SQL, TypeScript, Machine Learning, NLP, RoBERTa, Transformers, Scikit-learn, Pandas, "
            "NumPy, Random Forest, XGBoost, Feature Engineering, Model Serving, Model Deployment, Anomaly Detection, "
            "RAG, Agentic AI, FastAPI, Spring Boot, Angular, REST APIs, Microservices, Data Pipelines, ETL, AWS, GCP, "
            "Docker, CI/CD, Oracle, Sybase, MySQL, MongoDB, Redis"
        ),
        "summary": (
            "Aspiring AI/ML engineer with nearly 4 years of technical development experience across distributed "
            "systems, microservices, data pipelines, NLP, anomaly detection, model serving, RAG, and agentic AI."
        ),
        "cover_letter": (
            "I am interested in AI/ML engineering opportunities where I can apply nearly 4 years of technical "
            "development experience across distributed systems, data pipelines, NLP, feature engineering, and "
            "model serving. At UPS, I applied anomaly detection to shipment data, reduced manual escalations by "
            "25%, optimized query latency by 35%, and built a RoBERTa sentiment pipeline on 10K+ reviews with "
            "89% classification accuracy."
        ),
        "message_to_recruiter": (
            "Hi, I am Nikhil, an aspiring AI/ML Engineer with nearly 4 years in backend systems, data pipelines, "
            "NLP, anomaly detection, RAG and model serving. Open to AI/ML roles ready to contribute at scale now."
        ),
    },
    "form_preferences": {
        "work_authorization": "Yes",
        "sponsorship_required": "No",
        "willing_to_relocate": "Yes",
        "veteran_status": "No",
        "armed_forces_service": "No",
        "country_code": "+91",
        "phone_number_digits": "9597917991",
        "government_experience_details": "NA",
        "financial_interest_details": "NA",
        "prior_account_participation_details": "NO",
        "relationship_details": "NO",
        "rag_langgraph_experience_years": "4",
    },
    "form_qa": [
        {
            "question": "Are you willing to relocate?",
            "answer": "Yes",
            "intent": "relocation",
            "confidence": 53,
            "source": "learned_memory_import",
        },
        {
            "question": "Have you served in the Indian Armed forces?",
            "answer": "No",
            "intent": "veteran_status",
            "confidence": 70,
            "source": "learned_memory_import",
        },
        {
            "question": "Are you legally authorized to work in the country where the job is located without restrictions?",
            "answer": "Yes",
            "intent": "work_authorization",
            "confidence": 70,
            "source": "learned_memory_import",
        },
        {
            "question": "Will you now, or in the future, require sponsorship to work in the country where the job is located?",
            "answer": "No",
            "intent": "sponsorship",
            "confidence": 70,
            "source": "learned_memory_import",
        },
        {
            "question": "Country Code",
            "answer": "+91",
            "intent": "country_code",
            "confidence": 80,
            "source": "learned_memory_import",
        },
        {
            "question": "Preferred Phone Number",
            "answer": "9597917991",
            "intent": "phone",
            "confidence": 80,
            "source": "learned_memory_import",
        },
        {
            "question": "Description",
            "answer": "AI/ML and backend engineer with experience building scalable microservices, data pipelines, NLP systems, and production-grade distributed systems.",
            "domain": "developer.supercoder.co",
            "confidence": 80,
            "source": "learned_memory_import",
        },
        {
            "question": "Describe your experience building RAG systems, Langgraph",
            "answer": "4",
            "domain": "work.turing.com",
            "intent": "experience_years",
            "confidence": 80,
            "source": "learned_memory_import",
        },
    ],
    "learned_memory": [
        {
            "field_label": "Are you willing to relocate?",
            "field_intent": "relocation",
            "value": "Yes",
            "confidence": 53,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Have you served in the Indian Armed forces?",
            "field_intent": "veteran_status",
            "value": "No",
            "confidence": 70,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Nearest Metropolitan Area/City",
            "field_intent": "city",
            "value": "Chennai",
            "confidence": 98,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Are you legally authorized to work in the country where the job is located without restrictions?",
            "field_intent": "work_authorization",
            "value": "Yes",
            "confidence": 70,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Will you now, or in the future, require sponsorship to work in the country where the job is located?",
            "field_intent": "sponsorship",
            "value": "No",
            "confidence": 70,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Email Address",
            "field_intent": "email",
            "value": "mmmm.nikhil@gmail.com",
            "confidence": 80,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Country Code",
            "field_intent": "country_code",
            "value": "+91",
            "confidence": 80,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "First Name",
            "field_intent": "first_name",
            "value": "Nikhil",
            "confidence": 80,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Last Name",
            "field_intent": "last_name",
            "value": "Murugesan",
            "confidence": 80,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Preferred Phone Number",
            "field_intent": "phone",
            "value": "9597917991",
            "confidence": 80,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Please describe the nature of the employment. If this does not apply, type NA.",
            "value": "NA",
            "confidence": 70,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Please tell us if you have a financial interest in the firm doing the work. If this does not apply, type NA.",
            "value": "NA",
            "confidence": 65,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "If YES, please provide the dates and positions below. If NO, please type NO.",
            "value": "NO",
            "confidence": 70,
        },
        {
            "domain": "uhg.taleo.net",
            "field_label": "Yes/No Name? Relationship?",
            "value": "NO",
            "confidence": 80,
        },
        {
            "domain": "developer.supercoder.co",
            "field_label": "Description",
            "field_intent": "summary",
            "value": "AI/ML and backend engineer with experience building scalable microservices, data pipelines, NLP systems, and production-grade distributed systems.",
            "confidence": 80,
        },
        {
            "domain": "work.turing.com",
            "field_label": "Describe your experience building RAG systems, Langgraph",
            "field_intent": "experience_years",
            "value": "4",
            "confidence": 80,
        },
    ],
    "metadata": {
        "source": "resume_pdf_and_cover_letter_docx",
        "notes": [
            "Updated from NIKHIL_RESUME.pdf dated 2026-04-15 and Cover_Letter.docx dated 2026-04-24.",
            "Positioning is optimized for AI/ML engineer applications.",
            "Imported learned form memory as compact field-label/value answers on 2026-04-24.",
            "UPS start date normalized to Jun 2024 based on the latest resume.",
        ],
    },
}

try:
    from .user_data_personal import USER_PROFILE as LOCAL_USER_PROFILE
except Exception:
    LOCAL_USER_PROFILE = None


USER_PROFILE = LOCAL_USER_PROFILE or DEFAULT_USER_PROFILE


def get_user_data() -> dict:
    """Return a defensive copy of the active profile data."""

    return deepcopy(USER_PROFILE)

