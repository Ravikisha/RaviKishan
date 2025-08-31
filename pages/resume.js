import React from "react";
import jsPDF from "jspdf";
import Myphoto from "../public/assets/me1edit.jpg";
import html2canvas from "html2canvas";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { FaNpm, FaDocker } from "react-icons/fa";

const Resume = () => {
  const [darkTheme, setDarkTheme] = React.useState(false);
  const generateResume = () => {
    if (typeof window !== "undefined") {
      // setScaleCv(true);
      const input = document.getElementById("resume");
      html2canvas(input, { logging: true, scale: 2, useCORS: true })
        .then((canvas) => {
          const imgData = canvas.toDataURL("image/jpeg");
          const pdf = new jsPDF("p", "pt", [canvas.width, canvas.height]);
          var pdfWidth = pdf.internal.pageSize.getWidth();
          var pdfHeight = pdf.internal.pageSize.getHeight();
          pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
          pdf.save("Ravi_Kishan_Resume.pdf");
          setScaleCv(false);
        })
        .catch((err) => {
          console.log(err);
        });
    }
  };

  const skills = [
    {
      category: "Programming Languages",
      items: ["JavaScript", "TypeScript", "Java", "Python", "Go", "Rust", "C++", "C", "PHP"],
    },
    {
      category: "Frontend Technologies",
      items: [
        "React.js",
        "Next.js",
        "Tailwind CSS",
        "Astro",
        "SASS/SCSS",
        "PostCSS",
        "Redux",
        "Redux Saga",
        "Redux Toolkit",
        "Redux Thunk",
        "JAM",
        "Shadcn UI",
        "Jest",
        "Cypress",
        "Playwright",
        "WebPack",
      ],
    },
    {
      category: "Backend Frameworks",
      items: [
        "Node.js",
        "Express",
        "NestJS",
        "Django",
        "Flask",
        "FastAPI",
        "Laravel",
        "Spring Boot",
        "GraphQL",
        "gRPC",
        "REST API",
        "OAuth 2.0",
        "JWT",
      ],
    },
    {
      category: "Databases",
      items: ["PostgreSQL", "MySQL", "MongoDB", "Firebase", "Redis", "Neo4j", "ElasticSearch", "SupaBase"],
    },
    {
      category: "Cloud & DevOps",
      items: [
        "AWS",
        "EC2",
        "S3",
        "Lambda",
        "RDS",
        "DynamoDB",
        "ELB",
        "AKS",
        "IAM",
        "Azure",
        "GCP",
        "Docker",
        "Kubernetes",
        "Terraform",
        "CI/CD",
        "GitHub Actions",
        "Jenkins",
        "CDN",
        "Linux",
        "Nginx",
      ],
    },
    {
      category: "Other Tools",
      items: [
        "Kafka",
        "RabbitMQ",
        "Selenium",
        "Mocha",
        "Chai",
        "WebAssembly",
        "Git",
        "GitHub",
        "Flutter",
        "React Native",
        "ELK Stack",
        "Prometheus",
        "Grafana",
        "Markdown",
      ],
    },
  ]

  const courseWork = [
    {
      items: [
      "Computer Programming",
      "Computer Network",
      "DBMS",
      "Operating System",
      "Machine Learning",
      "Software Engineering",
      "Data Structures and Algorithms",
      "Artificial Intelligence",
      "Cloud Computing",
      "OOPS",
      "Cyber Security",
      "Software Testing",
      "Web Development"
    ]
    }
  ]

  return (
    <>
      <Head>
        <title>My Resume</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
      <div
        className={` ${
          darkTheme ? "dark-theme main__div " : "light-theme main__div"
        }`}
      >
        <div className="resume" id="resume" data-aos="fade-up">
          <main className="l-main bd-container">
            <div className="resume__container">
              <div className="resume__left">
                {/* home */}
                <section className="resume__home" id="home">
                  <div className="resume__home__container section bd-grid">
                    <div className="resume__home__data bd-grid">
                      <div className="resume__home__img">
                        <Image
                          src={Myphoto.src}
                          alt="MyImage"
                          width={500}
                          height={500}
                          objectFit="cover"
                          className="rounded-full"
                        />
                      </div>

                      <h1 className="resume__home__title">
                        Ravi <span>Kishan</span>
                      </h1>
                      <h3 className="resume__home__profession">
                        Full Stack Developer
                      </h3>

                      <div>
                        <Link
                          download
                          href="/Ravi_Kishan_Full_Stack_Developer_Resume.pdf"
                        >
                          <div
                            data-html2canvas-ignore
                            className="resume__home__button__movil"
                          >
                            Download
                          </div>
                        </Link>
                      </div>
                    </div>
                    <div className="resune__home__address bd-grid">
                      <span className="resume__home__information">
                        <i className="uil uil-map-marker resume__home__icon"></i>{" "}
                        Sari. Samastipur, Bihar - India 848101
                      </span>
                      <span className="resume__home__information">
                        <i className="uil uil-envelopes resume__home__icon"></i>{" "}
                        ravikishan63392@gmail.com
                      </span>
                      <span className="resume__home__information">
                        <i className="uil uil-phone resume__home__icon"></i>{" "}
                        +91-7061133910
                      </span>
                    </div>
                  </div>
                  <i
                    data-html2canvas-ignore
                    className={
                      darkTheme
                        ? "uil uil-sun resume__home__change__theme"
                        : "uil uil-moon resume__home__change__theme"
                    }
                    title="Theme"
                    id="theme-button"
                    onClick={() => setDarkTheme(!darkTheme)}
                  ></i>
                  <i
                    data-html2canvas-ignore
                    className="uil uil-download-alt resume__home__generate-pdf"
                    title="Generate PDF"
                    id="resume-button"
                    onClick={() => generateResume()}
                  ></i>
                </section>
                {/* social */}
                <section className="resume__social resume__section">
                  <h2 className="resume__section__title">SOCIAL</h2>
                  <div className="resume__social__container bd-grid">
                    <Link href="https://www.linkedin.com/in/ravikisha/">
                      <a target="_blank" className="resume__social__link">
                        <i className="uil uil-linkedin resume__social__icon"></i>{" "}
                        ravikisha
                      </a>
                    </Link>
                    <Link href="https://www.instagram.com/ravikishan.404/">
                      <a target="_blank" className="resume__social__link">
                        <i className="uil uil-instagram resume__social__icon"></i>{" "}
                        @ravikishan.404
                      </a>
                    </Link>
                    <Link href="https://github.com/Ravikisha">
                      <a target="_blank" className="resume__social__link">
                        <i className="uil uil-github resume__social__icon"></i>{" "}
                        ravikisha
                      </a>
                    </Link>
                  </div>
                </section>
                <section
                  className="resume__profile resume__section"
                  id="profile"
                >
                  <h2 className="resume__section__title">Profile</h2>
                  <p className="resume__profile__description">
                    Performance-driven Full Stack Developer & Computer Science
                    enthusiast skilled in building scalable, secure,
                    high-performance solutions across web, mobile, and cloud
                    platforms. Proficient in cloud-native development,
                    microservices, and DevOps, with expertise in designing
                    robust infrastructures optimized for seamless scalability
                    and automation. Passionate about system optimization, CI/CD,
                    and software reliability. Adept at solving complex problems
                    in dynamic environments where innovation drives success.
                    Seeking to contribute expertise in cutting-edge application
                    development, efficiency enhancement, and technological
                    excellence in a forward-thinking organization.
                  </p>
                </section>
                <section
                  className="resume__education resume__section"
                  id="education"
                >
                  <h2 className="resume__section__title">Education</h2>
                  <div className="resume__education__container bd-grid">
                    <div className="resume__education__content">
                      <div className="resume__education__time">
                        <span className="resume__education__rounded"></span>
                        <span className="resume__education__line"></span>
                      </div>
                      <div className="resume__education__data bd-grid">
                        <h3 className="resume__education__title">
                          {" "}
                          Master of Computer Application{" "}
                        </h3>
                        <span className="resume__education__studies">
                          Vellore Institute of Technology, Vellore, TN
                        </span>
                        <span className="resume__education__year">
                          2024 - Present
                        </span>
                      </div>
                    </div>
                    <div className="resume__education__content">
                      <div className="resume__education__time">
                        <span className="resume__education__rounded"></span>
                        <span className="resume__education__line"></span>
                      </div>
                      <div className="resume__education__data bd-grid">
                        <h3 className="resume__education__title">
                          {" "}
                          Bachelor of Computer Application{" "}
                        </h3>
                        <span className="resume__education__studies">
                          Prestige Institute of Management & Research, Gwalior
                        </span>
                        <span className="resume__education__year">
                          2021 - 2024
                        </span>
                      </div>
                    </div>
                    <div className="resume__education__content">
                      <div className="resume__education__time">
                        <span className="resume__education__rounded"></span>
                        <span className="resume__education__line"></span>
                      </div>
                      <div className="resume__education__data bd-grid">
                        <h3 className="resume__education__title">
                          {" "}
                          Intermediate (Math){" "}
                        </h3>
                        <span className="resume__education__studies">
                          BSEB, Patna
                        </span>
                        <span className="resume__education__year">
                          2019-2021
                        </span>
                      </div>
                    </div>
                    <div className="resume__education__content">
                      <div className="resume__education__time">
                        <span className="resume__education__rounded"></span>
                        <span className="resume__education__line"></span>
                      </div>
                      <div className="resume__education__data bd-grid">
                        <h3 className="resume__education__title">
                          {" "}
                          Matriculation{" "}
                        </h3>
                        <span className="resume__education__studies">
                          BSEB, Patna
                        </span>
                        <span className="resume__education__year">
                          2018 - 2019
                        </span>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="resume__languages resume__section">
                  <h2 className="resume__section__title">Skills</h2>

                  <div className="resume__languages__container">
                    <MicroChips skills={skills} />
                  </div>
                </section>
                <section className="resume__interests resume__section">
                  <h2 className="resume__section__title">CourseWork</h2>
                  <div className="resume__languages__container">
                    <MicroChips skills={courseWork} />
                  </div>
                </section>
                <section className="resume__languages resume__section">
                  <h2 className="resume__section__title">Languages</h2>

                  <div className="resume__languages__container">
                    <ul className="resume__languages__content bd-grid">
                      <li className="resume__languages__name">
                        <span className="resume__languages__circle"></span>{" "}
                        English
                      </li>
                      <li className="resume__languages__name">
                        <span className="resume__languages__circle"></span>{" "}
                        Hindi
                      </li>
                      <li className="resume__languages__name">
                        <span className="resume__languages__circle"></span>{" "}
                        Mathili
                      </li>
                      <li className="resume__languages__name">
                        <span className="resume__languages__circle"></span>{" "}
                        Bhojpuri
                      </li>
                    </ul>
                  </div>
                </section>
                <section className="resume__interests resume__section">
                  <h2 className="resume__section__title">Interests</h2>

                  <div className="resume__interests__container bd-grid">
                    <div className="resume__interests__content">
                      <i className="uil uil-subway"></i>
                      <span className="resume__interests__name">Traveling</span>
                    </div>
                    <div className="resume__interests__content">
                      <i className="uil uil-ticket"></i>
                      <span className="resume__interests__name">
                        Watching Movies
                      </span>
                    </div>
                    <div className="resume__interests__content">
                      <i className="uil uil-book-reader"></i>
                      <span className="resume__interests__name">Reading</span>
                    </div>
                  </div>
                </section>
                
              </div>
              <div className="resume__right">
                <section
                  className="resume__experience resume__section"
                  id="experience"
                >
                  <h2 className="resume__section__title">Experience</h2>

                  <div className="resume__experience__container bd-grid">
                    <div className="resume__experience__content">
                      <div className="resume__experience__time">
                        <span className="resume__experience__rounded"></span>
                        <span className="resume__experience__line"></span>
                      </div>
                      <div className="resume__experience__data bd-grid">
                        <h3 className="resume__experience__title">
                          Chiti Infotech Pvt. Ltd. | Full Stack Developer Intern
                        </h3>
                        <span className="resume__experience__company">
                          <i className="uil uil-clock resume__experience__icon"></i>{" "}
                          Jan 2023 – Sep 2023 | Gwalior, MP
                        </span>
                        <p className="resume__experience__description">
                          <ul className="fancy-bullet">
                            <li>
                              Spearheaded the migration of a legacy{" "}
                              <b>monolithic PHP application</b> to a modern{" "}
                              <b>React-based Single Page Application (SPA)</b>,
                              improving performance by <b>40%</b> and reducing
                              load times.
                            </li>
                            <li>
                              Developed and deployed <b>SPLANGO</b>, a customer
                              management system, enabling businesses to
                              efficiently track resources, onboard new clients,
                              and streamline workflows.
                            </li>
                            <li>
                              Implemented <b>Progressive Web App (PWA)</b>{" "}
                              support, ensuring cross-platform compatibility and
                              improving accessibility for users across multiple
                              operating systems.
                            </li>
                            <li>
                              Optimized front-end performance by leveraging{" "}
                              <b>React best practices</b>, state management, and
                              modular architecture, leading to a{" "}
                              <b>25% reduction in API response time</b>.
                            </li>
                            <li>
                              Collaborated with cross-functional teams using{" "}
                              <b>Git and GitHub</b>, improving version control
                              workflows and accelerating feature deployment by{" "}
                              <b>30%</b>.
                            </li>
                            <li>
                              Gained hands-on experience in{" "}
                              <b>
                                project management, time management, problem
                                solving
                              </b>
                              , and effective team collaboration.
                            </li>
                          </ul>
                        </p>
                      </div>
                    </div>
                    <div className="resume__experience__content">
                      <div className="resume__experience__time">
                        <span className="resume__experience__rounded"></span>
                        <span className="resume__experience__line"></span>
                      </div>
                      <div className="resume__experience__data bd-grid">
                        <h3 className="resume__experience__title">
                          Upwork (Remote) & Offline Clients | Freelance
                          Developer
                        </h3>
                        <span className="resume__experience__company">
                          <i className="uil uil-clock resume__experience__icon"></i>{" "}
                          Jan 2022 – Present | Remote & Onsite
                        </span>
                        <p className="resume__experience__description">
                          <ul className="fancy-bullet">
                            <li>
                              Successfully delivered <b>25+ projects</b> for
                              global clients, including enterprise applications,
                              SaaS platforms, and e-commerce solutions.
                            </li>
                            <li>
                              Designed and deployed scalable{" "}
                              <b>MERN stack applications</b> with optimized
                              performance, resulting in a{" "}
                              <b>35% increase in client engagement</b>.
                            </li>
                            <li>
                              Developed{" "}
                              <b>RESTful APIs and GraphQL endpoints</b> for
                              seamless data communication, enhancing application
                              efficiency and responsiveness.
                            </li>
                            <li>
                              Implemented <b>DevOps best practices</b>,
                              including CI/CD pipelines with{" "}
                              <b>Docker, GitHub Actions, and AWS</b>, reducing
                              deployment times by <b>50%</b>.
                            </li>
                            <li>
                              Designed and optimized{" "}
                              <b>database architectures</b> using{" "}
                              <b>MongoDB, PostgreSQL, and MySQL</b>, ensuring
                              high availability and performance.
                            </li>
                            <li>
                              Integrated{" "}
                              <b>authentication and authorization mechanisms</b>
                              , including{" "}
                              <b>
                                OAuth, JWT, and Role-Based Access Control (RBAC)
                              </b>{" "}
                              for secure user management.
                            </li>
                            <li>
                              Developed and optimized{" "}
                              <b>
                                SEO-friendly and accessible web applications
                              </b>
                              , improving search engine rankings and user
                              experience.
                            </li>
                            <li>
                              Collaborated with clients to define project scope,
                              timelines, and deliverables, ensuring timely
                              completion and high client satisfaction.
                            </li>
                          </ul>
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
                <section
                  className="resume__experience resume__section"
                  id="experience"
                >
                  <h2 className="resume__section__title">Projects</h2>

                  <div className="resume__experience__container bd-grid">
                    <div className="resume__experience__content">
                      <div className="resume__experience__time">
                        <span className="resume__experience__rounded"></span>
                        <span className="resume__experience__line"></span>
                      </div>
                      <div className="resume__experience__data bd-grid">
                        <h3 className="resume__experience__title">Relax.js</h3>
                        <span className="resume__experience__company">
                          <i className="uil uil-clock resume__experience__icon"></i>{" "}
                          Jan 2025 | Javascript <br />
                          <a href="https://github.com/Ravikisha/Relax.js">
                            <i className="uil uil-github resume__experience__icon"></i>{" "}
                            GitHub
                          </a>{" "}
                          |{" "}
                          <a href="https://www.npmjs.com/package/relaxcore">
                            {" "}
                            <FaNpm className="text-2xl inline" /> NPM
                          </a>
                        </span>
                        <p className="resume__experience__description">
                          Relax.js is a lightweight and modern frontend library
                          designed to simplify building dynamic web applications
                          using a virtual DOM and a component-based
                          architecture. It incorporates efficient DOM updates,
                          declarative state management, and a powerful API to
                          build scalable UIs. <br /> Relax.js is ideal for
                          developers who want to build interactive web
                          applications with a simple and intuitive API. It
                          provides a flexible and efficient way to manage state,
                          handle events, and create reusable components and it
                          only weighs 12KB.
                        </p>
                      </div>
                    </div>
                    <div className="resume__experience__content">
                      <div className="resume__experience__time">
                        <span className="resume__experience__rounded"></span>
                        <span className="resume__experience__line"></span>
                      </div>
                      <div className="resume__experience__data bd-grid">
                        <h3 className="resume__experience__title">RelaxLang</h3>
                        <span className="resume__experience__company">
                          <i className="uil uil-clock resume__experience__icon"></i>{" "}
                          Jan 2025 | Javascript <br />
                          <a href="https://github.com/Ravikisha/RelaxLang">
                            <i className="uil uil-github resume__experience__icon"></i>{" "}
                            GitHub
                          </a>{" "}
                          |{" "}
                          <a href="https://hub.docker.com/repository/docker/ravikishan63392/relaxlang/">
                            {" "}
                            <FaDocker className="text-2xl inline" /> Docker
                          </a>
                        </span>
                        <p className="resume__experience__description">
                          RelaxLang is a simple, interpreted programming
                          language implemented in Java. It is inspired by the
                          Lox programming language introduced in Robert
                          Nystrom&apos;s Crafting Interpreters. RelaxLang is designed
                          to be easy to understand and serve as an educational
                          tool for those interested in language design and
                          implementation.
                        </p>
                      </div>
                    </div>
                    <div className="resume__experience__content">
                      <div className="resume__experience__time">
                        <span className="resume__experience__rounded"></span>
                        <span className="resume__experience__line"></span>
                      </div>
                      <div className="resume__experience__data bd-grid">
                        <h3 className="resume__experience__title">GitaSaar</h3>
                        <span className="resume__experience__company">
                          <i className="uil uil-clock resume__experience__icon"></i>{" "}
                          Jan 2025 | Javascript <br />
                          <a href="https://github.com/ravikisha/gitasaar">
                            <i className="uil uil-github resume__experience__icon"></i>{" "}
                            GitHub
                          </a>
                        </span>
                        <p className="resume__experience__description">
                          A unique project that combines machine learning,
                          Shrimad Bhagavat Gita, and practical problem-solving.
                          In this application, we leverage a machine learning
                          model to teach the context of Shrimad Bhagavat Gita,
                          providing insights and solutions to daily life
                          problems through the wisdom of its slokas.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
                <section
                  className="resume__certificate resume__section"
                  id="certificates"
                >
                  <h2 className="resume__section__title">Certificates</h2>
                  <div className="resume__certificate__container bd-grid">
                    <div className="resume__certificate__content">
                      <h3 className="resume__certificate__title">
                        {" "}
                        Microsoft Certified: Azure Fundamentals (AZ-900)
                      </h3>
                      <div className="resume__certificate__description">
                        AZ-900: Microsoft Azure Fundamentals is an entry-level certification that demonstrates foundational knowledge of cloud services and how they are provided with Microsoft Azure. It is ideal for individuals starting their cloud journey or exploring Azure-based roles.
                        <ol className="style_2">
                          <li>
                            <Link href="https://learn.microsoft.com/en-us/users/RaviKishan-2421/credentials/13F8E52A4C9BC3EB">
                              <a target="_blank">AZ-900</a>
                            </Link>
                          </li>
                        </ol>
                      </div>
                    </div>
                    <div className="resume__certificate__content">
                      <h3 className="resume__certificate__title">
                        {" "}
                        Coursera: IBM Full Stack Developer
                      </h3>
                      <div className="resume__certificate__descridivtion">
                        IBM Full Stack Software Developer Professional Certificate is a beginner-friendly program on Coursera that equips learners with essential skills in front-end, back-end, and cloud-native development. Through hands-on projects using technologies like HTML, CSS, JavaScript, React, Node.js, Python, Docker, and Kubernetes, participants build a robust portfolio to showcase their capabilities in full-stack application development.
                        <ol className="style_2">
                          <li>
                          <Link href="https://www.coursera.org/account/accomplishments/specialization/88XYDYUS2WCA">
                            <a target="_blank">IBM Full Stack Software Developer (Specialization Certificate)</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/U8F3Q2WB49GL">
                            <a target="_blank">Introduction to Cloud Computing</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/BA6RQZ25N399">
                            <a target="_blank">Introduction to Web Development with HTML, CSS, JavaScript</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/2VXMDBPC76FN">
                            <a target="_blank">Getting Started with Git and GitHub</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/XB23HJYNQLFQ">
                            <a target="_blank">Developing Front-End Apps with React</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/U2QA7MWXA933">
                            <a target="_blank">Developing Back-End Apps with Node.js and Express</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/FJVPMNEKT8J2">
                            <a target="_blank">Python for Data Science, AI & Development</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/KXDVCSC5RSFW">
                            <a target="_blank">Developing AI Applications with Python and Flask</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/GWTYK6XDUU3R">
                            <a target="_blank">Django Application Development with SQL and Databases</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/8G5SEYYDGVKZ">
                            <a target="_blank">Introduction to Containers w/ Docker, Kubernetes & OpenShift</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/XVZ8X7Y4XBJJ">
                            <a target="_blank">Application Development using Microservices and Serverless</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/S9YHKGZU7KR8">
                            <a target="_blank">Full Stack Application Development Capstone Project</a>
                          </Link>
                        </li>
                        <li>
                          <Link href="https://www.coursera.org/account/accomplishments/certificate/BZK9E82KJQH8">
                            <a target="_blank">Full Stack Software Developer Assessment</a>
                          </Link>
                        </li>
                        </ol>
                      </div>
                    </div>
                    <div className="resume__certificate__content">
                      <h3 className="resume__certificate__title">
                        {" "}
                        Coursera: Meta Full Stack Developer (Meta Frontend Developer & Meta Backend Developer)
                      </h3>
                      <div className="resume__certificate__description">
                        Completed Meta’s professional certification covering both front-end and back-end development.
                        Gained hands-on experience with React, Node.js, Express, REST APIs, databases, and cloud deployment through practical projects.
                        <p className="font-bold mt-3">Meta Full Stack Developer</p>
                        <ol className="style_2">
                          <li>
                            <Link href="https://www.credly.com/badges/eae9db10-a75d-4e0b-a080-3880de79f9ca">
                              <a target="_blank">Meta Full Stack Developer Badge</a>
                            </Link>
                          </li>
                        </ol>
                        <p className="font-bold mt-3">Meta Front-End Developer</p>
                        <ol className="style_2">
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/specialization/7QEWSBLBS3VD">
                              <a target="_blank">Meta Front-End Developer (Specialization Certificate)</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/WW5K7Z7FE8H6">
                              <a target="_blank">Introduction to Front-End Development</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/9YCVUXK3YLC3">
                              <a target="_blank">Programming with JavaScript</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/YFWWZFE2R4PM">
                              <a target="_blank">Version Control</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/K8E26MSUDHAH">
                              <a target="_blank">HTML and CSS in Depth</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/35MUJM7R5DH2">
                              <a target="_blank">React Basics</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/29T9Z934W6WQ">
                              <a target="_blank">Advanced React</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/EUZXRTYZQZA3">
                              <a target="_blank">Principles of UX/UI Design</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/9NDWMNF4EGZY">
                              <a target="_blank">Front-End Developer Capstone</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/BKCWZ5TAQFRC">
                              <a target="_blank">Coding Interview Preparation</a>
                            </Link>
                          </li>
                        </ol>
                        <p className="font-bold mt-3">Meta Back-end Developer</p>
                        <ol className="style_2">
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/specialization/5FFKHJRLFXBD">
                              <a target="_blank">Meta Back-end Developer (Specialization Certificate)</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/BQ22D3M5FG8S">
                              <a target="_blank">Introduction to Back-End Development</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/HLH3DJ3X2A4N">
                              <a target="_blank">Programming in Python</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/YFWWZFE2R4PM">
                              <a target="_blank">Version Control</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/P9VVRUNF7FJ3">
                              <a target="_blank">Introduction to Databases for Back-End Development</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/DDPTJC2V4WN3">
                              <a target="_blank">Django Web Framework</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/4QGMQMRWFA3H">
                              <a target="_blank">APIs</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/HKBGUVE4V9FE">
                              <a target="_blank">The Full Stack</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/MWBEQJH44H2X">
                              <a target="_blank">Back-End Developer Capstone</a>
                            </Link>
                          </li>
                          <li>
                            <Link href="https://www.coursera.org/account/accomplishments/certificate/BKCWZ5TAQFRC">
                              <a target="_blank">Coding Interview Preparation</a>
                            </Link>
                          </li>
                        </ol>
                      </div>
                    </div>
                    <div className="resume__certificate__content">
                      <h3 className="resume__certificate__title">
                        {" "}
                        HackerRank Certified - Database (Basic & Advanced)
                      </h3>
                      <div className="resume__certificate__description">
                        HackerRank is the technology hiring platform that helps
                        developers to get certificates. I got basic,
                        intermediate & advanced certificates in database.
                        <ol className="style_2">
                          <li>
                            <Link href="https://www.hackerrank.com/certificates/120b2c2248e2"><a target="_blank">HackerRank - SQL Basic</a></Link>
                          </li>
                          <li>
                            <Link href="https://www.hackerrank.com/certificates/8dbfa216f123"><a target="_blank">HackerRank - SQL Intermidate</a></Link>
                          </li>
                        </ol>
                      </div>
                    </div>
                    <div className="resume__certificate__content">
                      <h3 className="resume__certificate__title">
                        {" "}
                        HackerRank Certified - JavaScript (Basic & Advanced)
                      </h3>
                      <div className="resume__certificate__descridivtion">
                        I got basic, intermediate & advanced certificates in
                        javascript. I solve many js concepts problems like
                        array, string, object, etc.
                        <ol className="style_2">
                          <li>
                            <Link href="https://www.hackerrank.com/certificates/de1c508f013b"><a target="_blank">HackerRank - JavaScript Basic</a></Link>
                          </li>
                          <li>
                            <Link href="https://www.hackerrank.com/certificates/176a88555f05"><a target="_blank">HackerRank - JavaScript Intermidate</a></Link>
                          </li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </section>
                {/* <section
                    className="resume__references resume__section"
                    id="references"
                  >
                    <h2 className="resume__section__title">References</h2>

                    <div className="resume__references__container bd-grid">
                      <div className="resume__references__content bd-grid">
                        <span className="resume__references__subtitle">
                          Sr. Director
                        </span>
                        <h3 className="resume__references__title">
                          Mr. John Doe
                        </h3>
                        <ul className="resume__references__contact">
                          <li>Phone: 999-777-666</li>
                          <li>Email: user@email.com</li>
                        </ul>
                      </div>
                      <div className="resume__references__content bd-grid">
                        <span className="resume__references__subtitle">
                          Sr. Director
                        </span>
                        <h3 className="resume__references__title">
                          Mr. John Doe
                        </h3>
                        <ul className="resume__references__contact">
                          <li>Phone: 999-777-666</li>
                          <li>Email: user@email.com</li>
                        </ul>
                      </div>
                    </div>
                  </section> */}
                  <section
                  className="resume__experience resume__section"
                  id="experience"
                >
                  <h2 className="resume__section__title">Achievements & Awards</h2>

                  <div className="resume__experience__container bd-grid">
                    <div className="resume__experience__content">
                      <ul className="fancy-bullet">
                        <li>
                          Participated in multiple <strong>Open-Source Contribution Events and Hackathons</strong>, demonstrating proficiency in <strong>collaborative development, version control (Git/GitHub), and Agile methodologies</strong>.
                        </li>
                        <li>
                          Successfully completed the <strong>Microsoft Learn Student Ambassador (MLSA)</strong> program, gaining expertise in <strong>Azure Cloud, AI, Full-Stack Development, and community leadership</strong>.
                        </li>
                        <li>
                          Solved <strong>1,200+ problems</strong> on <strong>LeetCode</strong> and <strong>GeeksforGeeks</strong>, demonstrating expertise in <strong>data structures, algorithms, problem-solving</strong>, and <strong>code optimization</strong>, aligning with industry standards.
                        </li>
                      </ul>
                      </div>
                    </div>
                  </section>
                {/* <div className="resume__skills resume__section" id="skills">
                  <h2 className="resume__section__title">Skills</h2>

                  <div className="resume__skills__content bd-grid">
                    <ul className="resume__skills__data">
                      <h2 className="mb-3">
                        Programming <br />
                        Language
                      </h2>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="python"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/python/python-original.svg"
                        />
                        <span className="ml-2">Python</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="javascript"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg"
                        />
                        <span className="ml-2">JavaScript</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="java"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg"
                        />
                        <span className="ml-2">Java</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="php"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/php/php-original.svg"
                        />
                        <span className="ml-2">Php</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="typescript"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg"
                        />
                        <span className="ml-2">TypeScript</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="c#"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/csharp/csharp-original.svg"
                        />
                        <span className="ml-2">C#</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="c++"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg"
                        />
                        <span className="ml-2">C++</span>
                      </li>
                    </ul>

                    <ul className="resume__skills__data">
                      <h2 className="mb-3">Frontend</h2>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="react"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg"
                        />
                        <span className="ml-2">React</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="next js"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/nextjs/nextjs-original.svg"
                        />
                        <span className="ml-2">Next.js</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="redux"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/redux/redux-original.svg"
                        />
                        <span className="ml-2">Redux</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="sass"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/sass/sass-original.svg"
                        />
                        <span className="ml-2">Sass</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="tailwindcss"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/tailwindcss/tailwindcss-original.svg"
                        />
                        <span className="ml-2">TailwindCss</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="jquery"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/jquery/jquery-original.svg"
                        />
                        <span className="ml-2">JQuery</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="wordpress"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/wordpress/wordpress-plain.svg"
                        />
                        <span className="ml-2">WordPress</span>
                      </li>
                    </ul>
                    <ul className="resume__skills__data">
                      <h2 className="mb-3">Backend</h2>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="express"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/express/express-original.svg"
                        />
                        <span className="ml-2">Express</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="django"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/django/django-plain.svg"
                        />
                        <span className="ml-2">Django</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="flask"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/flask/flask-original.svg"
                        />
                        <span className="ml-2">Flask</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="laravel"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/laravel/laravel-original.svg"
                        />
                        <span className="ml-2">Laravel</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="mysql"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/mysql/mysql-original.svg"
                        />
                        <span className="ml-2">MySQL</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="postgresql"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/postgresql/postgresql-original.svg"
                        />
                        <span className="ml-2">PostgreSQL</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="graphql"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/graphql/graphql-plain.svg"
                        />
                        <span className="ml-2">GraphQL</span>
                      </li>
                      <li className="resume__skills_name">
                        <Image
                          className="resue__skills__img"
                          width={30}
                          height={30}
                          alt="kafka"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg"
                        />
                        <span className="ml-2">Kafka</span>
                      </li>
                    </ul>
                    <ul className="resume__skills__data">
                      <h2 className="mb-3">
                        App
                        <br />
                        Development
                      </h2>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="flutter"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/flutter/flutter-original.svg"
                        />
                        <span className="ml-2">Flutter</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="java android"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/androidstudio/androidstudio-original.svg"
                        />
                        <span className="ml-2">Java Android</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="kotlin android"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kotlin/kotlin-original.svg"
                        />
                        <span className="ml-2">Kotlin Android</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="react native"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/react/react-original.svg"
                        />
                        <span className="ml-2">React Native</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="ionic"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/ionic/ionic-original.svg"
                        />
                        <span className="ml-2">Ionic</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt=".net core"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/dotnetcore/dotnetcore-original.svg"
                        />
                        <span className="ml-2">.Net Core</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="electron"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/electron/electron-original.svg"
                        />
                        <span className="ml-2">Electron</span>
                      </li>
                    </ul>
                    <ul className="resume__skills__data">
                      <h2 className="mb-3">Others</h2>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="git"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/git/git-original.svg"
                        />
                        <span className="ml-2">Git</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="github"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg"
                        />
                        <span className="ml-2">GitHub</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="docker"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/docker/docker-original.svg"
                        />
                        <span className="ml-2">Docker</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="kubernetes"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/kubernetes/kubernetes-plain.svg"
                        />
                        <span className="ml-2">Kubernetes</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="vscode"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/vscode/vscode-original.svg"
                        />
                        <span className="ml-2">VSCode</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="bash"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/bash/bash-original.svg"
                        />
                        <span className="ml-2">Bash</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="markdown"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/markdown/markdown-original.svg"
                        />
                        <span className="ml-2">MarkDown</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="ubuntu"
                          src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/ubuntu/ubuntu-plain.svg"
                        />
                        <span className="ml-2">Ubuntu</span>
                      </li>
                    </ul>
                    <ul className="resume__skills__data">
                      <h2 className="mb-3">Learning Now</h2>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="data science"
                          src="https://cdn-icons-png.flaticon.com/512/2821/2821637.png"
                        />
                        <span className="ml-2">Data Science</span>
                      </li>

                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="Machine Learning"
                          src="https://cdn-icons-png.flaticon.com/512/4616/4616734.png"
                        />
                        <span className="ml-2">Machine Learning</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="deep learning"
                          src="https://cdn-icons-png.flaticon.com/512/2103/2103832.png"
                        />
                        <span className="ml-2">Deep Learning</span>
                      </li>
                      <li className="resume__skills__name">
                        <Image
                          className="resume__skills__img"
                          width={30}
                          height={30}
                          alt="cloud computing"
                          src="https://cdn-icons-png.flaticon.com/512/356/356490.png"
                        />
                        <span className="ml-2">Cloud Computing</span>
                      </li>
                    </ul>
                  </div>
                </div> */}
              </div>
            </div>
          </main>
          <a
            data-html2canvas-ignore
            href="#"
            className="scrollTop"
            id="scroll-top"
          >
            <i className="uil uil-arrow-up scrollTop__icon"></i>
          </a>
        </div>
      </div>
    </>
  );
};

function MicroChips({ skills }) {
  return (
    <div className="space-y-3 print:space-y-1.5">
      {skills.map((skillGroup) => (
        <div key={skillGroup.category} className="mb-1">
          {
            skillGroup.category && <h3 className="text-sm font-semibold text-gray-700 mb-1.5 print:text-xs">{skillGroup.category}:</h3>
          }
          <div className="flex flex-wrap gap-1">
            {skillGroup.items.map((skill) => (
              <span
                key={skill}
                className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-800 text-xs border border-gray-200 rounded"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}


export default Resume;
