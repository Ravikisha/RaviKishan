import React, { useState } from "react";
import Link from "next/link";

const Header = () => {
  const [Toggle, showMenu] = useState(false);
  return (
    <header className="header" id="header">
      <nav className="nav container_mod">
        <a href="#" className="nav__logo" style={{ fontFamily: "Allison" }}>
          Ravi Kishan
        </a>

        <div
          className={Toggle ? "nav__menu show-menu" : "nav__menu"}
          id="nav-menu"
        >
          <ul className="nav__list grid_mod">
            <li className="nav__item">
              <Link href="/">
                <span className="nav__link">
                <i className="uil uil-estate nav__icon"></i>Home
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/about" className="nav__link">
              <span className="nav__link">
                <i className="uil uil-user nav__icon"></i>About
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/skills">
                <span className="nav__link">
                <i className="uil uil-file-alt nav__icon"></i>Skills
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/resume">
                <span className="nav__link">
                <i className="uil uil-briefcase-alt nav__icon"></i>Resume
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/projects">
                <span className="nav__link">
                <i className="uil uil-scenery nav__icon"></i>Projects
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/contact">
                <span className="nav__link">
                <i className="uil uil-message nav__icon"></i>Contact
                </span>
              </Link>
            </li>
          </ul>
          <i
            className="uil uil-times nav__close"
            id="nav-close"
            onClick={() => showMenu(!Toggle)}
          ></i>
        </div>
        <div className="nav__btns">
          <div
            className="nav__toggle"
            id="nav-toggle"
            onClick={() => showMenu(!Toggle)}
          >
            <i className="uil uil-apps"></i>
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Header;
