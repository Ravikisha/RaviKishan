import {Earth} from './../components/earth';
import ContactForm from './../components/contactForm';
import Head from 'next/head';

const Contact = () => {
    return(
        <>
        <Head>
        <title>Contact Page</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
        <div className="earth__container">
            <Earth />
            {/* <Water /> */}
            <ContactForm />
            </div>
        </>
    )
}
export default Contact