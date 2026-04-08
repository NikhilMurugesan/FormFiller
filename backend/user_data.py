# This is a mock database of user profile data.
# In a real application, you might fetch this from a database based on an authenticated user.
USER_PROFILE = {
  "personal_info": {
    "full_name": "Nikhil Murugesan",
    "first_name": "Nikhil",
    "last_name": "Murugesan",
    "email": "mmmm.nikhil@gmail.com",
    "phone": "+91-9597917991",
    "location": {
      "city": "Chennai",
      "state": "Tamil Nadu",
      "country": "India",
      "full_location": "Greater Chennai Area, India"
    },
    "headline": "AI/ML Engineer | Python, AWS | Building Scalable ML Pipelines & LLM-Based Systems | Ex Full Stack Developer",
    "summary": "Started as a full-stack developer and moved deeper into backend, data, and AI/ML engineering. Built production-grade distributed systems in Java and Spring Boot, optimized Oracle queries, designed event-driven services, shipped dashboards, and recently built ML/NLP systems including sentiment analysis with RoBERTa, LLM-integrated applications with FastAPI, and inference optimization work.",
    "linkedin_url": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",
    "portfolio_url": "https://nikhilmurugesan.in",
    "website_url": "https://nikhilmurugesan.in",
    "github_url": "https://github.com/NikhilMurugesan",
    "current_title": "Application Developer",
    "current_company": "UPS Supply Chain Solutions",
    "open_to_work": true,
    "employment_type_preference": "Full-time",
    "work_authorization": "Indian Citizen"
      },
  "professional_profile": {
    "primary_role": "AI/ML Engineer",
    "secondary_roles": [
      "Backend Engineer",
      "Full Stack Developer"
    ],
    "total_years_experience": 4,
    "domains": [
      "AI/ML",
      "Backend Engineering",
      "Distributed Systems",
      "Logistics",
      "NLP",
      "Microservices"
    ]
  },
  "skills": {
    "top_skills": [
      "Feature Engineering",
      "Retrieval-Augmented Generation (RAG)",
      "Model Training & Evaluation"
    ],
    "programming_languages": [
      "Python",
      "Java"
    ],
    "frameworks": [
      "Spring Boot",
      "Spring Cloud",
      "Angular",
      "FastAPI"
    ],
    "ai_ml": [
      "NLP",
      "LLM Integration",
      "Hugging Face Transformers",
      "RoBERTa",
      "Sentiment Analysis",
      "Inference Optimization",
      "Quantization",
      "Feature Engineering",
      "Model Training",
      "Model Evaluation",
      "RAG"
    ],
    "cloud_devops": [
      "AWS",
      "Docker",
      "OpenShift"
    ],
    "databases": [
      "Oracle",
      "MySQL",
      "SYBASE",
      "Redis"
    ],
    "architecture": [
      "Microservices",
      "REST APIs",
      "Event-Driven Systems",
      "Distributed Systems"
    ],
    "tools": [
      "Black Duck",
      "GEM",
      "SonarQube"
    ]
  },
  "experience": [
    {
      "company": "UPS Supply Chain Solutions",
      "title": "Application Developer",
      "employment_type": "Full-time",
      "location": "Chennai, India",
      "start_date": "2024-09",
      "end_date": "Present",
      "is_current": true,
      "description": "Enterprise logistics platform serving 21M+ daily package operations globally.",
      "achievements": [
        "Designed and built RESTful microservices using Java and Spring Boot for real-time package tracking and logistics orchestration, handling 50K+ API calls/day.",
        "Engineered data processing pipelines to aggregate and transform operational data from multiple warehouse sources for near-real-time shipment visibility.",
        "Built automated anomaly detection workflows to flag delayed shipments and route deviations, reducing manual escalation overhead by ~25%.",
        "Developed internal analytics dashboards integrating backend APIs with Angular frontends for KPI monitoring.",
        "Optimized Oracle query performance across 21+ tables with complex joins, reducing average query latency by 35%.",
        "Built a RoBERTa-based sentiment analysis system to classify 10K+ Google Maps reviews across UPS outlet locations.",
        "Implemented automated review ingestion, preprocessing, and batch inference pipelines for 5K+ outlet locations.",
        "Participated in on-call rotations, resolved production incidents, and implemented proactive monitoring."
      ],
      "technologies": [
        "Java",
        "Spring Boot",
        "Python",
        "Angular",
        "Oracle",
        "Hugging Face",
        "RoBERTa",
        "REST APIs",
        "Microservices"
      ]
    },
    {
      "company": "Virtusa",
      "title": "Associate Software Engineer",
      "employment_type": "Full-time",
      "location": "Chennai, Tamil Nadu, India",
      "start_date": "2022-05",
      "end_date": "2024-09",
      "is_current": false,
      "achievements": [
        "Engineered migration of 7+ screens from Struts-HTML to Angular and Spring Boot aligned with microservice architecture principles.",
        "Created 21+ tables and stored procedures in SYBASE to preserve continuity of data operations during transition.",
        "Revamped DBTool functionalities to maintain consistent stored procedure result sets across Oracle and SYBASE for 50+ stored procedures.",
        "Identified and remediated software vulnerabilities using Black Duck and GEM.",
        "Transitioned components from JDK 11 to JDK 17 for improved compatibility and performance.",
        "Resolved SonarQube issues to improve code quality and sustainability.",
        "Reduced load times by 40% and improved user experience."
      ],
      "technologies": [
        "Angular",
        "Spring Boot",
        "SYBASE",
        "Oracle",
        "JDK 11",
        "JDK 17",
        "Black Duck",
        "GEM",
        "SonarQube"
      ]
    },
    {
      "company": "Virtusa",
      "title": "Full Stack Developer",
      "employment_type": "Full-time",
      "location": "Chennai, Tamil Nadu, India",
      "start_date": "2022-01",
      "end_date": "2022-05",
      "is_current": false,
      "achievements": [
        "Led a team of 6 developers to design, develop, and deploy a Recharge Management full stack application using Spring Boot, Angular, and MySQL.",
        "Coordinated project tasks, timelines, and priorities to improve execution.",
        "Improved team productivity by 30% and reduced project delivery time by 15%.",
        "Increased user satisfaction and engagement by 20%.",
        "Reduced system errors by 25% and increased application reliability by 40%."
      ],
      "technologies": [
        "Spring Boot",
        "Angular",
        "MySQL"
      ]
    }
  ],
  "education": [
    {
      "institution": "Vellore Institute of Technology",
      "degree": "Bachelor's degree",
      "field_of_study": "Computer Engineering",
      "start_year": 2018,
      "end_year": 2022
    }
  ],
  "projects": [
    {
      "name": "RoBERTa Sentiment Analysis for UPS Reviews",
      "category": "AI/ML",
      "description": "Built a sentiment analysis system using RoBERTa and Hugging Face to classify 10K+ Google Maps reviews and surface customer satisfaction insights.",
      "technologies": [
        "Python",
        "RoBERTa",
        "Hugging Face Transformers",
        "NLP"
      ]
    },
    {
      "name": "AI Job Search Copilot",
      "category": "LLM Application",
      "description": "Built an AI job search copilot with FastAPI and LLM integration.",
      "technologies": [
        "FastAPI",
        "Python",
        "LLM"
      ]
    }
  ],
  "links": {
    "linkedin": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",
    "portfolio": "https://nikhilmurugesan.in",
    "website": "https://nikhilmurugesan.in"
  },
  "job_preferences": {
    "target_roles": [
      "AI/ML Engineer",
      "Backend Engineer",
      "Backend or AI/ML Engineering Roles"
    ],
    "preferred_employment_type": "Full-time",
    "open_to_opportunities": true,
    "preferred_locations": ["Chennai","Coimbatore","Bangalore","Hyderabad"],
    "remote_preference": "Hybrid"
  },
  "autofill_fields": {
    "name": "Nikhil Murugesan",
    "full_name": "Nikhil Murugesan",
    "first_name": "Nikhil",
    "last_name": "Murugesan",
    "email": "mmmm.nikhil@gmail.com",
    "phone": "+91-9597917991",
    "current_company": "UPS Supply Chain Solutions",
    "current_title": "Application Developer",
    "location": "Greater Chennai Area, India",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "country": "India",
    "linkedin": "https://www.linkedin.com/in/nikhil-murugesan-2484b4180",
    "portfolio": "https://nikhilmurugesan.in",
    "website": "https://nikhilmurugesan.in",
    "highest_degree": "Bachelor's degree",
    "school": "Vellore Institute of Technology",
    "major": "Computer Engineering",
    "years_of_experience": "4",
    "skills": "Python, Java, Spring Boot, Spring Cloud, FastAPI, Angular, AWS, Docker, OpenShift, Oracle, MySQL, SYBASE, Redis, NLP, Hugging Face, RoBERTa, Sentiment Analysis, LLM Integration, RAG, Feature Engineering, Model Training, Model Evaluation, Microservices, REST APIs, Distributed Systems",
    "summary": "AI/ML and backend engineer with experience building scalable microservices, data pipelines, NLP systems, and production-grade distributed systems."
  },
  "metadata": {
    "source": "resume_pdf",
    "notes": [
      "Phone number not found in the uploaded PDF.",
      "UPS experience has a date inconsistency in the source: heading says September 2024 - Present, body mentions Jun 2024 - Present.",
      "LinkedIn URL was normalized from parsed PDF text."
    ]
  }
}


def get_user_data() -> dict:
    """Retrieves the user profile data."""
    return USER_PROFILE
