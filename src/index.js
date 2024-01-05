const cheerio = require('cheerio')

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  htmlToPDF,
  createCozyPDFDocument,
  log
} = require('cozy-konnector-libs')
// const moment = require('moment')
const request = requestFactory({
  cheerio: true,
  json: false,
  jar: true
})

const baseUrl = 'https://www.digitick.com'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/user/orders`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    identifiers: ['digitick'],
    contentType: 'application/pdf'
  })
}

function authenticate(email, passwd) {
  return signin({
    url: `${baseUrl}/user/login`,
    formSelector: 'form[action="/login/st"]',
    formData: { 'User.Email': email, Password: passwd },
    validate: (statusCode, $) => {
      if ($('.field-validation-error').length === 0) {
        return true
      } else {
        log('error', $('.field-validation-error').text())
        return false
      }
    }
  })
}

async function parseDocuments($) {
  var docs = []

  // Open each event link to retreive informations about order
  const events = $('li', '#user-order-list ul.customer-order-list').toArray()
  for (var i = 0; i < events.length; i++) {
    const link =
      baseUrl + $('a.g-blocklist-link.view-order-link', events[i]).attr('href')
    const $doc = await request(link)

    const doc = scrape($doc('body'), {
      vendorRef: {
        sel: 'header h2',
        parse: parseVendorRef
      },
      eventlabel: {
        sel: 'strong.g-order-summary-top-title'
      },
      eventdate: {
        sel: 'span.pv-sharedreponsive-connected-event-time'
      },
      date: {
        sel: '.g-ui-box-content p:first-child:not(.g-order-summary-top)',
        parse: parseDate
      },
      stringDate: {
        sel: '.g-ui-box-content p:first-child:not(.g-order-summary-top)'
      },
      amount: {
        sel: '#jsOrderTotal',
        parse: parseAmount
      },
      stringAmount: {
        sel: '#jsOrderTotal',
        parse: parseStringAmount
      },
      customerName: {
        sel: '.cs-order-address-customer-name',
        parse: parseName
      },
      customerAddress: {
        sel: '.cs-order-address-customer-address',
        parse: parseAddress
      }
    })

    const rows = generateRows($doc)

    const html = `<body>
          <h5>Digitick</h5>
          <p><b>&nbsp\n Commande n°${doc.vendorRef}</b></p>
          <p>${doc.stringDate}</p>
          <p><b>${doc.eventlabel}</b> - ${doc.eventdate} \n&nbsp</p>
          <table>
            <th><b>Tarif</b></th>
            <th><b>Montant</b></th>
            <th><b>Quantité</b></th>
            ${rows}
            <tr>
              <td><b>Total</b></td>
              <td colspan="2"><b>${doc.stringAmount}</b></td>
            </tr>
          </table>
          <p><b>&nbsp\n Adresse de facturation</b></p>
          <span>${doc.customerName}</span>
          <span>${doc.customerAddress.street} ${doc.customerAddress.city}</span>
          <span>${doc.customerAddress.zipCode}</span>
          <span>${doc.customerAddress.country}</span>
      </body>`

    const $html = cheerio.load(html)

    var pdf = createCozyPDFDocument('Généré par Cozy \n\n', link)
    htmlToPDF($html, pdf, $html('body'))
    doc.filestream = pdf
    doc.filestream.end()

    doc.formatedDate = `${doc.date.getFullYear()}-${(
      '0' +
      (doc.date.getMonth() + 1)
    ).slice(-2)}-${('0' + doc.date.getDate()).slice(-2)}`

    docs.push(doc)
  }

  return docs.map(({ vendorRef, amount, date, filestream, formatedDate }) => ({
    vendorRef,
    date,
    currency: '€',
    vendor: 'digitick',
    filename: `${formatedDate}_digitick_${amount}€_${vendorRef}.pdf`,
    metadata: {
      importDate: new Date(),
      version: 1
    },
    amount,
    filestream
  }))
}

/**
 * For each order items, generate an html row
 * @param {*} $doc
 * @return String html : all the html rows
 */
function generateRows($doc) {
  const items = $doc('li', 'ul.g-order-summary-items').toArray()
  var html = ''

  items.forEach(item => {
    $doc('a').remove()
    const tariffParts = $doc('.g-order-summary-item-name', item)
      .text()
      .split(' ')

    const quantity = tariffParts[0].trim()
    let tariff = ''
    for (var i = 2; i < tariffParts.length; i++) {
      tariff += tariffParts[i].trim() + ' '
    }

    var amount = $doc('.g-order-summary-item-amount', item).data(
      'face-value-total'
    )
    if (amount === undefined) {
      amount = $doc('.g-order-summary-item-amount', item).text()
    }
    amount = amount.trim().replace('€', '') + ' €'

    html += `<tr>
              <td>${tariff}</td>
              <td>${amount}</td>
              <td>${quantity}</td>
             </tr>`
  })
  return html
}

/* function parseToDate(date, format) {
  return moment(date, format).toDate()
} */

function parseName(name) {
  return name.replace(',', '')
}

function parseStringAmount(amount) {
  return amount.replace('€', '') + ' €'
}

function parseAmount(amount) {
  amount = amount.replace('€', '')
  amount = amount.replace(',', '.')
  return parseFloat(amount)
}

function parseAddress(address) {
  var parts = address.split('\n') // get each line of the address
  for (var i = 0; i < parts.length; i++) {
    // for each line
    // Remove spaces
    for (var e = 0; e < 2; e++) {
      parts[i] = parts[i].trim()
      if (parts[i] === '') {
        parts.splice(i, 1)
      }
    }
    parts[i] = parts[i].trim()
    parts[i] = parts[i].replace(',', '')
  }

  address = {}
  address.zipCode = parts[2]
  address.country = parts[3]
  address.city = parts[1]
  address.street = parts[0]
  return address
}

/**
 * Get vendor reference from the html title of the order
 * @param {*} title
 */
function parseVendorRef(title) {
  title = title.split(' ')
  return title[7]
}

function parseDate(date) {
  date = date.replace(' à', '')
  date = date.replace('Commande reçue ', '')
  date = date.split(' ')

  switch (date[2]) {
    case 'janv.':
      date[2] = '01'
      break
    case 'févr.':
      date[2] = '02'
      break
    case 'mars':
      date[2] = '03'
      break
    case 'avr.':
      date[2] = '04'
      break
    case 'mai.':
      date[2] = '05'
      break
    case 'juin':
      date[2] = '06'
      break
    case 'juill.':
      date[2] = '07'
      break
    case 'aout':
      date[2] = '08'
      break
    case 'sept.':
      date[2] = '09'
      break
    case 'oct.':
      date[2] = '10'
      break
    case 'nov.':
      date[2] = '11'
      break
    case 'déc.':
      date[2] = '12'
      break
  }
  const day = `${date[3]}-${date[2]}-${date[1]}`
  return new Date(`${day} ${date[4]}`)
}
