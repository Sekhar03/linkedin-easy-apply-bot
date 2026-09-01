import sys
import json
import re

# Comprehensive list of tech skills
SKILLS_LIBRARY = [
    "Python", "Java", "JavaScript", "C++", "C#", "Ruby", "PHP", "Swift", "Kotlin", "Go", "Rust", "TypeScript",
    "React", "React JS", "React.js", "Angular", "Vue.js", "Vue", "Node.js", "Node", "Express", "Django", "Flask", "Spring Boot", "ASP.NET", "Ruby on Rails",
    "HTML", "CSS", "HTML5", "CSS3", "SASS", "LESS", "Bootstrap", "Tailwind", "REST APIs", "GraphQL", "Microservices",
    "SQL", "MySQL", "PostgreSQL", "Oracle", "SQL Server", "NoSQL", "MongoDB", "Cassandra", "Redis", "Elasticsearch",
    "AWS", "Azure", "Google Cloud", "GCP", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "Git", "GitHub", "GitLab", "CI/CD",
    "Linux", "Unix", "Bash", "Shell Scripting", "PowerShell",
    "Machine Learning", "Deep Learning", "NLP", "Computer Vision", "TensorFlow", "PyTorch", "Scikit-learn", "Pandas", "NumPy", "Data Analysis",
    "Agile", "Scrum", "Kanban", "JIRA", "Confluence", "TDD", "BDD", "Unit Testing", "Selenium", "Cypress", "Playwright", "Jest", "Mocha", "Postman",
    "System Architecture", "Object-Oriented Design", "Object Oriented", "Algorithm Design", "Data Structures", "Problem Solving", "Analytical Skills",
    "C", "Perl", "Scala", "Dart", "Flutter", "React Native", "Android", "iOS", "Redux", "MobX", "Vuex", "RxJS", "WebSockets", "Socket.io",
    "Firebase", "Supabase", "Heroku", "Vercel", "Netlify", "DigitalOcean", "Nginx", "Apache", "Kafka", "RabbitMQ", "ActiveMQ",
    "Jupyter", "Matplotlib", "Seaborn", "Tableau", "PowerBI", "Excel", "Data Mining", "Data Warehousing", "ETL", "Hadoop", "Spark",
    "Blockchain", "Web3", "Smart Contracts", "Solidity", "Rust", "IoT", "AR/VR", "Unity", "Unreal Engine",
    "Figma", "Sketch", "Adobe XD", "Photoshop", "Illustrator", "UI/UX", "User Research", "Wireframing", "Prototyping",
    "SEO", "SEM", "Google Analytics", "Google Ads", "Facebook Ads", "Email Marketing", "Content Marketing", "Copywriting",
    "Salesforce", "HubSpot", "Zendesk", "Intercom", "Customer Support", "Technical Support", "ITIL", "ServiceNow",
    "PMP", "PRINCE2", "IT Project Management", "Risk Management", "Budgeting", "Stakeholder Management", "Communication Skills", "Presentation Skills"
]

def clean_text(text):
    return text.lower()

def extract_skills(text, skill_list):
    text_lower = clean_text(text)
    found_skills = set()
    for skill in skill_list:
        # Use word boundaries or simple substring depending on skill type
        # For C, C++, C# we need careful boundary checks.
        skill_clean = skill.lower()
        if skill_clean in ['c', 'c++', 'c#']:
            # Require whitespace/punctuation boundaries around it
            pattern = r'(^|[^a-zA-Z0-9])' + re.escape(skill_clean) + r'([^a-zA-Z0-9]|$)'
            if re.search(pattern, text_lower):
                found_skills.add(skill)
        else:
            # For longer words, a simple boundary check is good
            pattern = r'\b' + re.escape(skill_clean) + r'\b'
            if re.search(pattern, text_lower):
                found_skills.add(skill)
    return found_skills

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)
        
    jd_path = sys.argv[1]
    cv_path = sys.argv[2]
    
    try:
        with open(jd_path, 'r', encoding='utf-8') as f:
            jd_text = f.read()
        with open(cv_path, 'r', encoding='utf-8') as f:
            cv_text = f.read()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
        
    # 1. Extract required skills from Job Description
    required_skills = extract_skills(jd_text, SKILLS_LIBRARY)
    
    if not required_skills:
        # If no recognizable skills found in JD, we can't reliably score.
        print(json.dumps({
            "score": 50,
            "matchingSkills": [],
            "missingSkills": []
        }))
        sys.exit(0)
        
    # 2. Check which of the required skills are in the CV
    matching_skills = extract_skills(cv_text, required_skills)
    missing_skills = required_skills - matching_skills
    
    # 3. Calculate Score
    score = int((len(matching_skills) / len(required_skills)) * 100)
    
    result = {
        "score": score,
        "matchingSkills": list(matching_skills),
        "missingSkills": list(missing_skills)
    }
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
