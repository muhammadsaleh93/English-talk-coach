// Lessons for each level. Add or change topics here.
// role = who the AI coach plays, goal = what the learner should practise.
window.TOPICS = {
  beginner: [
    { id: "intro", icon: "👋", title: "Introduce yourself", role: "a new friendly classmate meeting the learner for the first time", goal: "say your name, where you are from and what you do" },
    { id: "routine", icon: "⏰", title: "My daily routine", role: "a friend asking about the learner's normal day", goal: "talk about what you do every day using simple present tense" },
    { id: "family", icon: "👨‍👩‍👧", title: "My family", role: "a friendly neighbour", goal: "talk about your family members" },
    { id: "shop", icon: "🛒", title: "At the shop", role: "a shopkeeper in a small grocery shop", goal: "ask for items, ask prices and pay" },
    { id: "food", icon: "🍔", title: "Ordering food", role: "a waiter in a restaurant", goal: "order food and drinks politely" },
    { id: "directions", icon: "🗺️", title: "Asking directions", role: "a helpful person on the street", goal: "ask how to get to a place and understand simple directions" },
  ],
  intermediate: [
    { id: "interview", icon: "💼", title: "Job interview", role: "an HR manager interviewing the learner for a job they choose", goal: "answer interview questions about experience, strengths and goals" },
    { id: "doctor", icon: "🩺", title: "At the doctor", role: "a friendly doctor", goal: "describe how you feel and understand advice" },
    { id: "hotel", icon: "🏨", title: "Travel & hotel", role: "a hotel receptionist", goal: "book a room, ask about facilities and solve a small problem" },
    { id: "hobbies", icon: "🎨", title: "Hobbies & free time", role: "a new colleague during a coffee break", goal: "talk about your interests and ask follow-up questions" },
    { id: "phone", icon: "📞", title: "Phone call", role: "a customer service agent for an internet company", goal: "explain a problem on the phone and get help" },
    { id: "past", icon: "📖", title: "Tell a story", role: "a friend who wants to hear about the learner's last holiday or weekend", goal: "tell a story using past tense" },
  ],
  advanced: [
    { id: "debate", icon: "⚖️", title: "Friendly debate", role: "a debate partner who takes the opposite side on a topic the learner picks (for example: social media, remote work, AI)", goal: "give opinions, reasons and counter-arguments" },
    { id: "meeting", icon: "📊", title: "Business meeting", role: "a manager leading a project meeting", goal: "give updates, suggest ideas and agree on next steps" },
    { id: "negotiation", icon: "🤝", title: "Negotiation", role: "a supplier negotiating price and delivery terms", goal: "negotiate politely and reach a deal" },
    { id: "news", icon: "📰", title: "Discuss the news", role: "a well-informed friend discussing current topics in technology, science or society", goal: "express nuanced opinions using advanced vocabulary" },
    { id: "presentation", icon: "🎤", title: "Present an idea", role: "an investor listening to the learner's business or project idea", goal: "present clearly and answer tough questions" },
    { id: "ielts", icon: "🎓", title: "IELTS speaking test", role: "an IELTS speaking examiner running parts 1, 2 and 3 of the test", goal: "practise for the IELTS speaking exam" },
  ],
};

window.FREE_TALK = { id: "free", icon: "💬", title: "Free talk", role: "a friendly conversation partner", goal: "talk about anything you like" };
