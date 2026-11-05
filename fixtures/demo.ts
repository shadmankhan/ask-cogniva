export const organizations = [
  {
    name: "Northbridge University", slug: "northbridge-university", email: "northbridge@example.test",
    files: [
      { name: "Merit Scholarship Rules.pdf", pages: [
        [
          "Northbridge University - Academic Merit Scholarship",
          "Minimum GPA: 3.5",
          "Eligible academic years: 2, 3, 4",
          "Athletic awards are prohibited as concurrent aid.",
          "Need-based bursaries are allowed as concurrent aid.",
        ],
        [
          "Academic Merit Scholarship application procedure",
          "Apply through the student portal under Funding, then Scholarships.",
          "Upload your transcript and a signed recommendation.",
          "The Academic Merit Scholarship deadline is 15 March.",
          "The Academic Merit Scholarship award is 2,000 credits.",
        ],
      ] },
      { name: "Library and Access Bursary.pdf", pages: [
        [
          "Northbridge University Library",
          "The library opens at 08:00 on weekdays.",
          "The library opens at 10:00 on Saturdays.",
          "The Northbridge library desk code is OBSERVATORY-17.",
        ],
        [
          "Northbridge Access Bursary",
          "The Access Bursary award is 750 credits.",
          "The Access Bursary is based on household income and financial need.",
          "The Access Bursary deadline is 30 April.",
        ],
      ] },
    ],
  },
  {
    name: "Harborlight Makerspace", slug: "harborlight-makerspace", email: "harborlight@example.test",
    files: [
      { name: "Equipment Booking Guide.pdf", pages: [
        [
          "Harborlight Makerspace - Equipment Booking",
          "Use the member portal to reserve the laser cutter.",
          "Complete the safety orientation before your first laser cutter booking.",
          "Laser cutter reservations last up to 90 minutes.",
        ],
        [
          "3D Printer Booking",
          "Reserve a 3D printer through the member portal.",
          "3D printer reservations last up to 180 minutes.",
          "Bring approved filament to your 3D printer session.",
        ],
      ] },
      { name: "Hours and Membership.pdf", pages: [
        [
          "Harborlight Makerspace Hours",
          "The makerspace opens at 12:00 on weekdays.",
          "Members must check in at the front desk.",
        ],
        [
          "Membership Policy",
          "Guest passes allow entry with a member present.",
          "Guest passes do not permit independent equipment use.",
        ],
      ] },
    ],
  },
];

export const demoQuestions = [
  { org: 0, type: "Direct", question: "When does the library open on weekdays?", expected: "08:00", source: "Library and Access Bursary.pdf p. 1" },
  { org: 0, type: "Direct", question: "What is the Academic Merit Scholarship deadline?", expected: "15 March", source: "Merit Scholarship Rules.pdf p. 2" },
  { org: 0, type: "Procedural", question: "How do I apply for the Academic Merit Scholarship?", expected: "Student portal, transcript, and recommendation", source: "Merit Scholarship Rules.pdf p. 2" },
  { org: 0, type: "Policy", question: "Can I combine a need-based bursary with the Academic Merit Scholarship?", expected: "Allowed", source: "Merit Scholarship Rules.pdf p. 1" },
  { org: 0, type: "Comparison", question: "Compare the amounts of the Academic Merit Scholarship and the Access Bursary.", expected: "2,000 and 750 credits", source: "Merit Scholarship Rules.pdf p. 2 and Library and Access Bursary.pdf p. 2" },
  { org: 0, type: "Multi-condition", question: "Am I eligible for the Academic Merit Scholarship? I am in year 3, my GPA is 3.8, and I already receive the Varsity Basketball Grant, awarded for playing on the varsity basketball team.", expected: "Not eligible. GPA and year pass, athletic aid conflicts.", source: "Merit Scholarship Rules.pdf p. 1" },
  { org: 0, type: "Multi-condition", question: "Am I eligible for the Academic Merit Scholarship? I am in year 2, have a GPA of 3.7, and have no existing scholarship.", expected: "Eligible", source: "Merit Scholarship Rules.pdf p. 1" },
  { org: 0, type: "Clarification", question: "Am I eligible for the Academic Merit Scholarship? I am in year 2 and have no scholarship.", expected: "Ask for GPA" },
  { org: 0, type: "Direct", question: "What is the Northbridge library desk code?", expected: "OBSERVATORY-17", source: "Library and Access Bursary.pdf p. 1" },
  { org: 1, type: "Isolation and unanswerable", question: "What is the Northbridge library desk code?", expected: "No answer" },
  { org: 1, type: "Procedural", question: "How do I reserve the laser cutter?", expected: "Member portal and safety orientation", source: "Equipment Booking Guide.pdf p. 1" },
  { org: 1, type: "Comparison", question: "Compare laser cutter and 3D printer reservation durations.", expected: "90 and 180 minutes", source: "Equipment Booking Guide.pdf pp. 1–2" },
  { org: 1, type: "Policy", question: "Can guests use equipment independently?", expected: "No", source: "Hours and Membership.pdf p. 2" },
  { org: 1, type: "Unanswerable", question: "Which airport has nonstop flights to Mars?", expected: "No answer" },
];
