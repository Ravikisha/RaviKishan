import React from "react";
import jsPDF from "jspdf";
import Myphoto from "../public/assets/me1edit.jpg";
import html2canvas from "html2canvas";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";

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
                        <div
                          data-html2canvas-ignore
                          
                          className="resume__home__button__movil"
                        >
                          <Link 
                            download
                            href="/resume.pdf" >
                          Download
                          </Link>
                        </div>
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
                    <Link href="https://www.linkedin.com/in/ravi-kishan-62ab51221/">
                      <a target="_blank" className="resume__social__link">
                        <i className="uil uil-linkedin resume__social__icon"></i>{" "}
                        ravi-kishan-62ab51221
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
                  Performance-driven Full Stack Developer & Computer Science enthusiast skilled in building scalable, secure, high-performance solutions across web, mobile, and cloud platforms. Proficient in cloud-native development, microservices, and DevOps, with expertise in designing robust infrastructures optimized for seamless scalability and automation. Passionate about system optimization, CI/CD, and software reliability. Adept at solving complex problems in dynamic environments where innovation drives success. Seeking to contribute expertise in cutting-edge application development, efficiency enhancement, and technological excellence in a forward-thinking organization.
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
                  <h2 className="resume__section__title">Projects</h2>

                  <div className="resume__experience__container bd-grid">
                    <div className="resume__experience__content">
                      <div className="resume__experience__time">
                        <span className="resume__experience__rounded"></span>
                        <span className="resume__experience__line"></span>
                      </div>
                      <div className="resume__experience__data bd-grid">
                        <h3 className="resume__experience__title">
                          My Portfolio
                        </h3>
                        <span className="resume__experience__company">
                        Portfolio Site | Ravi Kishan
                        </span>
                        <p className="resume__experience__description">
                          I made this website as my portfolio. I used React,
                          Next.js, sass, Tailwind CSS, and Framer Motion for
                          this project. I used Next.js for server side rendering
                          and SEO. I used Framer Motion for animations. I used
                          Tailwind CSS for styling. I used sass for styling.In
                          this site, I use firebase for contact form. I use
                          vercel for deployment. It is so easy to use. Site is
                          online now on{" "}
                          <Link href="/">
                            <a
                              target="_blank"
                              className="ml-2 underline text-sky-500"
                            >
                              This
                            </a>
                          </Link>
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
                          International Conference
                        </h3>
                        <span className="resume__experience__company">
                          Official Site | Prestige Institute of Management &
                          Research
                        </span>
                        <p className="resume__experience__description">
                          I made this website as an official site for an
                          international conference. I used React, Plain CSS, and
                          Tailwind CSS for this project. I use firebase for
                          contact form. I use netlify for deployment. It has so
                          many features like collage details, conference
                          details, and contact form. It is fully responsive. It
                          is so easy to use. Site is online now on
                          <Link href="https://statuesque-moxie-abc30a.netlify.app/">
                            <a target="_blank" className="ml-2 text-sky-500">
                              https://statuesque-moxie-abc30a.netlify.app/
                            </a>
                          </Link>
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
                          Social App
                        </h3>
                        <span className="resume__experience__company">
                          Collage Project | Prestige Institute of Management &
                          Research
                        </span>
                        <p className="resume__experience__description">
                          I made this website as a social app. I used React,
                          Next.js, Sass, Tailwind CSS for frontend and Laravel,
                          PostgreSQL and Redis for backend. This project is for
                          collage submittion. I made this website with my small
                          team and we got 1st prize in collage.
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
                    <div className="resume__certificate__content">
                      <h3 className="resume__certificate__title">
                        {" "}
                        Kaggle & LinkedIn & HackerRank & Study Section - Python
                      </h3>
                      <div className="resume__certificate__description">
                        I got certificates in python on kaggle, linkedin, study section and
                        hacker rank for solving many python problems. I have a
                        great practices in python.
                        <ol className="style_2">
                          <li>
                            <Link href="https://www.linkedin.com/learning/certificates/8ea30dce67c429b4f3a61092f29b57898002211df1114e214d3c52a1e5584c00?lipi=urn%3Ali%3Apage%3Ad_flagship3_profile_view_base_recent_activity_details_shares%3Bt0k91ZPfQ9uwADKA26Zrxg%3D%3D"><a target="_blank">LinkedIn - Python</a></Link>
                          </li>
                          <li>
                            <Link href="https://www.hackerrank.com/certificates/00c704a00b03"><a target="_blank">HackerRank - Python</a></Link>
                          </li>
                          <li>
                            <Link href="https://www.linkedin.com/posts/ravi-kishan-62ab51221_ive-completed-the-python-course-on-kaggle-activity-6920311115713249280-ZU20?utm_source=share&utm_medium=member_desktop"><a target="_blank">Kaggle - Python</a></Link>
                          </li>
                          <li>
                            <Link href="https://www.linkedin.com/posts/ravi-kishan-62ab51221_python-certification-activity-6947911258880770049-y5Lb?utm_source=share&utm_medium=member_desktop"><a target="_blank">Study Section - Python</a></Link>
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
                <div className="resume__skills resume__section" id="skills">
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
                </div>
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

export default Resume;

// function generateResume() {
//   var data = document.getElementById('resume');
//   html2canvas(data, { useCORS:true}) // useCORS is optional if your images are externally hosted somewhere like s3
//   .then(canvas => {
//     const contentDataURL = canvas.toDataURL('image/png')
//     let pdf = new jsPDF('p', 'pt', [canvas.width, canvas.height]);
//     var pdfWidth = pdf.internal.pageSize.getWidth();
//     var pdfHeight = pdf.internal.pageSize.getHeight();
//     pdf.addImage
// (contentDataURL, 'PNG',  pdfWidth, pdfHeight);
//     //  pdf.save('new-file.pdf');
//     window.open(pdf.output('bloburl', { filename: 'new-file.pdf' }), '_blank');
//   });

// }
