"""Public-safe default user profile.

Keep personal data in ``backend/user_data_personal.py`` locally if needed.
That file is ignored by git and will override this template automatically.
"""

from copy import deepcopy


DEFAULT_USER_PROFILE = {
    "personal_info": {
        "full_name": "",
        "first_name": "",
        "last_name": "",
        "email": "",
        "phone": "",
        "location": {
            "city": "",
            "state": "",
            "country": "",
            "full_location": "",
        },
        "headline": "",
        "summary": "",
        "linkedin_url": "",
        "portfolio_url": "",
        "website_url": "",
        "github_url": "",
        "current_title": "",
        "current_company": "",
        "open_to_work": False,
        "employment_type_preference": "",
        "work_authorization": "",
    },
    "professional_profile": {
        "primary_role": "",
        "secondary_roles": [],
        "total_years_experience": 0,
        "domains": [],
    },
    "skills": {
        "top_skills": [],
        "programming_languages": [],
        "frameworks": [],
        "ai_ml": [],
        "cloud_devops": [],
        "databases": [],
        "architecture": [],
        "tools": [],
    },
    "experience": [],
    "education": [],
    "projects": [],
    "links": {
        "linkedin": "",
        "portfolio": "",
        "website": "",
        "github": "",
    },
    "job_preferences": {
        "target_roles": [],
        "preferred_employment_type": "",
        "open_to_opportunities": False,
        "preferred_locations": [],
        "remote_preference": "",
    },
    "autofill_fields": {
        "name": "",
        "full_name": "",
        "first_name": "",
        "last_name": "",
        "email": "",
        "phone": "",
        "current_company": "",
        "current_title": "",
        "location": "",
        "city": "",
        "state": "",
        "country": "",
        "linkedin": "",
        "portfolio": "",
        "website": "",
        "github": "",
        "highest_degree": "",
        "school": "",
        "major": "",
        "years_of_experience": "",
        "skills": "",
        "summary": "",
    },
    "metadata": {
        "source": "public_template",
        "notes": [
            "Populate backend/user_data_personal.py locally to use personal autofill data.",
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
