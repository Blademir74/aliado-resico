// create-users.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();  // npm install dotenv --save-dev

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan variables de entorno. Crea un archivo .env con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const users = [
  { email: 'cliente1@dominio.com', password: 'Temp123!', nombre: 'Cliente Uno' },
  { email: 'cliente2@dominio.com', password: 'Temp123!', nombre: 'Cliente Dos' },
  { email: 'cliente3@dominio.com', password: 'Temp123!', nombre: 'Cliente Tres' },
  { email: 'cliente4@dominio.com', password: 'Temp123!', nombre: 'Cliente Cuatro' },
  { email: 'cliente5@dominio.com', password: 'Temp123!', nombre: 'Cliente Cinco' },
];

async function createUsers() {
  for (const u of users) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.nombre, role: 'contribuyente' },
    });
    if (error) {
      console.error(`❌ Error con ${u.email}:`, error.message);
    } else {
      console.log(`✅ Usuario creado: ${u.email} (ID: ${data.user.id})`);
    }
  }
}

createUsers();