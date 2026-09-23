'use strict';

const SUPABASE_URL = 'https://yvzvfyocemaiehfpvuza.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LmHAftJ5GY_yTXvXITHMkg_qyh8yOuh';
const $ = id => document.getElementById(id);
let cliente;
let usuario = null;
let libros = [];
let editando = null;
let borradorId = null;
let nuevaImagen = null;
let quitarPortada = false;
let previaLocal = null;
let ocupado = false;
let cargando = false;
let cargaCompleta = false;
let revision = 0;
let revisionImagen = 0;
const imagenes = new Map();
const normalizar = valor => String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function mensaje(texto, error = false) {
    $('mensaje').textContent = texto;
    $('mensaje').classList.toggle('error', error);
}

function bloquear(valor) {
    ocupado = valor;
    $('camposLibro').disabled = valor;
    for (const id of ['cerrarSesion', 'exportar', 'importar', 'actualizar']) $(id).disabled = valor;
    document.querySelectorAll('.botones button').forEach(b => b.disabled = valor);
}

function portada(contenedor, url, titulo = 'Portada del libro') {
    contenedor.replaceChildren();
    const vacio = document.createElement('span');
    vacio.textContent = 'Sin imagen';
    if (!url) { contenedor.append(vacio); return; }
    const img = document.createElement('img');
    img.src = url;
    img.alt = titulo;
    img.loading = 'lazy';
    img.onerror = () => { vacio.textContent = 'Imagen no disponible'; contenedor.replaceChildren(vacio); };
    contenedor.append(img);
}

function limpiar() {
    revisionImagen++;
    $('formulario').reset();
    editando = null;
    borradorId = null;
    nuevaImagen = null;
    quitarPortada = false;
    if (previaLocal) URL.revokeObjectURL(previaLocal);
    previaLocal = null;
    portada($('vistaPrevia'), null);
    $('quitarImagen').hidden = true;
    $('cancelar').hidden = true;
    $('formTitulo').textContent = 'Registrar libro';
    $('guardar').textContent = 'Guardar libro';
}

function aplicarSesion(sesion) {
    const siguiente = sesion?.user || null;
    if (usuario?.id === siguiente?.id) return;
    revision++;
    usuario = siguiente;
    libros = [];
    cargaCompleta = false;
    imagenes.clear();
    limpiar();
    bloquear(false);
    $('lista').replaceChildren();
    $('buscar').value = '';
    $('filtro').replaceChildren(new Option('Todos', ''));
    $('cantidad').textContent = '0';
    $('vacio').hidden = true;
    $('catalogo').hidden = !usuario;
    $('inicioSesion').hidden = !!usuario;
    $('contrasena').value = '';
    $('contrasena').type = 'password';
    $('mostrarContrasena').checked = false;
    mensaje('');
    if (usuario) {
        $('cuentaCorreo').textContent = usuario.email;
        $('errorLogin').textContent = '';
        $('estado').textContent = 'Cargando biblioteca...';
        cargar();
    } else {
        $('cuentaCorreo').textContent = '';
        $('correo').focus();
    }
}

async function cargar(forzar = false) {
    if (!usuario || cargando || (ocupado && !forzar)) return;
    cargando = true;
    const actual = usuario.id;
    const turno = revision;
    try {
        const todos = [];
        for (let desde = 0; ; desde += 500) {
            const { data, error } = await cliente.from('libros').select('*').eq('usuario_id', actual).order('id').range(desde, desde + 499);
            if (error) throw error;
            todos.push(...data);
            if (data.length < 500) break;
        }
        if (usuario?.id !== actual || turno !== revision) return;
        const rutas = [...new Set(todos.map(l => l.imagen_ruta).filter(r => r && r.startsWith(actual + '/')))];
        const pendientes = rutas.filter(r => !imagenes.has(r) || imagenes.get(r).vence < Date.now());
        for (let i = 0; i < pendientes.length; i += 100) {
            const { data, error } = await cliente.storage.from('portadas').createSignedUrls(pendientes.slice(i, i + 100), 3600);
            if (!error) for (const item of data || []) {
                if (item.signedUrl && !item.error) imagenes.set(item.path, { url: item.signedUrl, vence: Date.now() + 3300000 });
            }
        }
        if (usuario?.id !== actual || turno !== revision) return;
        libros = todos;
        cargaCompleta = true;
        renderizar();
        $('estado').textContent = 'Actualizado a las ' + new Date().toLocaleTimeString('es', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    } catch (error) {
        if (usuario?.id === actual && turno === revision) {
            $('estado').textContent = 'No se pudo actualizar. Revisa tu conexion y pulsa Actualizar.';
            if (!cargaCompleta) mensaje('No se pudieron consultar los libros. ' + errorTexto(error), true);
        }
    } finally {
        cargando = false;
        if (usuario && (usuario.id !== actual || turno !== revision) && !ocupado) setTimeout(() => cargar(), 0);
    }
}

function errorTexto(error) {
    if (error?.code === '42501') return 'El acceso fue rechazado. Revisa los permisos de la cuenta.';
    if (error?.code === '23505') return 'Este registro ya existe. Pulsa Actualizar para comprobarlo.';
    if (error?.code === '23514' || error?.code === '22001') return 'Revisa la longitud de los campos y el año.';
    return error?.message || 'Intenta de nuevo cuando tengas conexion.';
}

function renderizar() {
    if (!usuario) return;
    const filtro = $('filtro').value;
    $('filtro').replaceChildren(new Option('Todos', ''));
    [...new Set(libros.map(l => l.movimiento || 'Sin clasificar'))].sort((a, b) => a.localeCompare(b, 'es')).forEach(m => $('filtro').add(new Option(m, m)));
    $('filtro').value = [...$('filtro').options].some(o => o.value === filtro) ? filtro : '';
    const texto = normalizar($('buscar').value.trim());
    const visibles = libros.filter(l => normalizar([l.titulo, l.autor, l.movimiento, l.anio, l.comentario].join(' ')).includes(texto) && (!$('filtro').value || (l.movimiento || 'Sin clasificar') === $('filtro').value));
    const orden = $('orden').value;
    visibles.sort((a, b) => {
        if (orden === 'antiguo' || orden === 'reciente') {
            if (a.anio === null && b.anio !== null) return 1;
            if (b.anio === null && a.anio !== null) return -1;
            return (orden === 'antiguo' ? a.anio - b.anio : b.anio - a.anio) || a.titulo.localeCompare(b.titulo, 'es');
        }
        return (a[orden] || '').localeCompare(b[orden] || '', 'es', {sensitivity: 'base'}) || a.titulo.localeCompare(b.titulo, 'es');
    });
    $('lista').replaceChildren();
    for (const libro of visibles) {
        const tarjeta = document.createElement('article');
        tarjeta.className = 'libro';
        const imagen = document.createElement('div');
        imagen.className = 'portada';
        portada(imagen, imagenes.get(libro.imagen_ruta)?.url, 'Portada de ' + libro.titulo);
        const ficha = document.createElement('div');
        ficha.className = 'ficha';
        for (const [tag, clase, texto] of [
            ['span', 'etiqueta', libro.movimiento || 'Sin clasificar'],
            ['h3', '', libro.titulo],
            ['p', 'autor', libro.autor],
            ['span', 'anio', libro.anio === null ? 'Año sin especificar' : 'Publicado en ' + libro.anio],
            ['p', 'comentario', libro.comentario || 'Sin comentarios.']
        ]) {
            const elemento = document.createElement(tag);
            elemento.className = clase;
            elemento.textContent = texto;
            ficha.append(elemento);
        }
        const acciones = document.createElement('div');
        acciones.className = 'botones';
        for (const [texto, clase, accion] of [['Editar', 'secundario', () => editar(libro)], ['Eliminar', 'eliminar', () => eliminar(libro)]]) {
            const boton = document.createElement('button');
            boton.type = 'button'; boton.textContent = texto; boton.className = clase; boton.disabled = ocupado; boton.onclick = accion;
            acciones.append(boton);
        }
        ficha.append(acciones); tarjeta.append(imagen, ficha); $('lista').append(tarjeta);
    }
    $('cantidad').textContent = visibles.length + ' de ' + libros.length;
    $('vacio').hidden = visibles.length > 0 || !cargaCompleta;
    $('vacio').textContent = libros.length ? 'No hay libros que coincidan con tu busqueda.' : 'Todavia no tienes libros. Registra el primero arriba.';
}

function editar(libro) {
    if (ocupado) return;
    limpiar();
    editando = {...libro};
    for (const campo of ['titulo', 'autor', 'movimiento', 'anio', 'comentario']) $(campo).value = libro[campo] ?? '';
    portada($('vistaPrevia'), imagenes.get(libro.imagen_ruta)?.url);
    $('quitarImagen').hidden = !libro.imagen_ruta;
    $('cancelar').hidden = false;
    $('formTitulo').textContent = 'Editar libro';
    $('guardar').textContent = 'Guardar cambios';
    mensaje('');
    $('formulario').scrollIntoView({block: 'start'});
    $('titulo').focus({preventScroll: true});
}

function mismaVersion(consulta, libro) {
    for (const campo of ['titulo', 'autor', 'movimiento', 'anio', 'comentario', 'imagen_ruta']) {
        consulta = libro[campo] === null ? consulta.is(campo, null) : consulta.eq(campo, libro[campo]);
    }
    return consulta;
}

async function eliminar(libro) {
    if (ocupado || !usuario || !confirm('¿Eliminar "' + libro.titulo + '" y su portada?')) return;
    bloquear(true); revision++;
    try {
        const consulta = cliente.from('libros').delete().eq('id', libro.id).eq('usuario_id', usuario.id);
        const {data, error} = await mismaVersion(consulta, libro).select('id');
        if (error) throw error;
        if (!data.length) throw new Error('El libro cambio en otro dispositivo o ya fue eliminado. Actualiza la lista antes de intentarlo.');
        let advertencia = '';
        if (libro.imagen_ruta?.startsWith(usuario.id + '/')) {
            const {error: falloImagen} = await cliente.storage.from('portadas').remove([libro.imagen_ruta]);
            if (falloImagen) advertencia = ' La portada no pudo retirarse del almacenamiento.';
        }
        if (editando?.id === libro.id) limpiar();
        libros = libros.filter(l => l.id !== libro.id);
        renderizar(); mensaje('Libro eliminado.' + advertencia);
    } catch (error) { mensaje('No se pudo completar la eliminacion. ' + errorTexto(error), true); }
    finally { bloquear(false); await cargar(); }
}

async function prepararImagen(archivo) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type)) throw new Error('Selecciona una imagen JPG, PNG o WebP.');
    if (archivo.size > 10 * 1024 * 1024) throw new Error('La imagen debe pesar como maximo 10 MB.');
    const bitmap = await createImageBitmap(archivo);
    try {
        const escala = Math.min(1, 1000 / bitmap.width, 1400 / bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * escala));
        canvas.height = Math.max(1, Math.round(bitmap.height * escala));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen.')), 'image/jpeg', .85));
    } finally { bitmap.close(); }
}

async function guardar(evento) {
    evento.preventDefault();
    if (!usuario || ocupado) return;
    const datos = {
        titulo: $('titulo').value.trim(), autor: $('autor').value.trim(),
        movimiento: $('movimiento').value.trim(), anio: $('anio').value === '' ? null : Number($('anio').value),
        comentario: $('comentario').value.trim()
    };
    if (!datos.titulo || !datos.autor) { mensaje('Escribe el titulo y el autor.', true); return; }
    const uid = usuario.id;
    const anterior = editando ? {...editando} : null;
    const id = anterior?.id || borradorId || crypto.randomUUID();
    borradorId = id;
    bloquear(true); revision++;
    let nuevaRuta = null;
    let confirmado = false;
    try {
        let ruta = quitarPortada ? null : anterior?.imagen_ruta || null;
        if (nuevaImagen) {
            nuevaRuta = uid + '/' + crypto.randomUUID() + '.jpg';
            const {error} = await cliente.storage.from('portadas').upload(nuevaRuta, nuevaImagen, {contentType: 'image/jpeg', upsert: false});
            if (error) throw error;
            ruta = nuevaRuta;
        }
        const fila = {...datos, imagen_ruta: ruta};
        let resultado;
        if (anterior) {
            const consulta = cliente.from('libros').update(fila).eq('id', id).eq('usuario_id', uid);
            resultado = await mismaVersion(consulta, anterior).select();
        } else {
            resultado = await cliente.from('libros').insert({...fila, id, usuario_id: uid}).select();
        }
        if (resultado.error) {
            if (nuevaRuta && /^(23|42)/.test(resultado.error.code || '')) {
                await cliente.storage.from('portadas').remove([nuevaRuta]);
            }
            throw resultado.error;
        }
        if (!resultado.data.length) {
            if (nuevaRuta) await cliente.storage.from('portadas').remove([nuevaRuta]);
            throw new Error('El libro fue modificado en otro dispositivo. Tu borrador sigue aqui: actualiza y vuelve a abrir el libro antes de guardar.');
        }
        confirmado = true;
        if (usuario?.id !== uid) return;
        libros = [...libros.filter(l => l.id !== id), resultado.data[0]];
        cargaCompleta = true;
        let avisoImagen = '';
        if (anterior?.imagen_ruta && anterior.imagen_ruta !== ruta && anterior.imagen_ruta.startsWith(uid + '/')) {
            const {error} = await cliente.storage.from('portadas').remove([anterior.imagen_ruta]);
            if (error) avisoImagen = ' La portada anterior no pudo retirarse del almacenamiento.';
        }
        limpiar(); renderizar();
        mensaje((anterior ? 'Cambios guardados en tu cuenta.' : 'Libro registrado exitosamente en tu cuenta.') + avisoImagen);
    } catch (error) {
        if (usuario?.id === uid) mensaje((confirmado ? 'El libro se guardo, pero hubo un problema adicional. ' : 'No se confirmo el guardado. Tu borrador se conserva; pulsa Actualizar antes de reintentar. ') + errorTexto(error), true);
    } finally { bloquear(false); await cargar(); }
}

function blobComoTexto(blob) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader(); lector.onload = () => resolve(lector.result); lector.onerror = () => reject(new Error('No se pudo leer la imagen.')); lector.readAsDataURL(blob);
    });
}

async function exportar() {
    if (!usuario || ocupado) return;
    const uid = usuario.id;
    bloquear(true);
    try {
        if (cargando) throw new Error('Espera a que termine la actualizacion y vuelve a intentarlo.');
        await cargar(true);
        if (!cargaCompleta || !$('estado').textContent.startsWith('Actualizado')) throw new Error('Actualiza la biblioteca antes de descargar el respaldo.');
        if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
        const copia = [];
        const listaRespaldo = [...libros];
        for (const l of listaRespaldo) {
            if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
            const libro = {titulo: l.titulo, autor: l.autor, movimiento: l.movimiento, anio: l.anio, comentario: l.comentario};
            if (l.imagen_ruta) {
                const {data, error} = await cliente.storage.from('portadas').download(l.imagen_ruta);
                if (error) throw new Error('No se pudo respaldar la portada de "' + l.titulo + '". Intenta de nuevo.');
                libro.imagen_base64 = await blobComoTexto(data);
            }
            copia.push(libro);
        }
        if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
        const url = URL.createObjectURL(new Blob([JSON.stringify({version: 2, libros: copia}, null, 2)], {type: 'application/json'}));
        const enlace = document.createElement('a'); enlace.href = url; enlace.download = 'biblioteca_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.append(enlace); enlace.click(); enlace.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        mensaje('Respaldo descargado con los datos y las portadas.');
    } catch (error) { mensaje(errorTexto(error), true); }
    finally { bloquear(false); }
}

function validarImportado(l) {
    return l && typeof l.titulo === 'string' && l.titulo.trim() && l.titulo.length <= 200 && typeof l.autor === 'string' && l.autor.trim() && l.autor.length <= 200 && typeof l.movimiento === 'string' && l.movimiento.length <= 100 && typeof l.comentario === 'string' && l.comentario.length <= 3000 && (l.anio === '' || l.anio === null || (Number.isInteger(l.anio) && l.anio >= -5000 && l.anio <= 9999)) && (!l.imagen_base64 || (typeof l.imagen_base64 === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(l.imagen_base64) && l.imagen_base64.length <= 14000000));
}

async function importar() {
    const archivo = $('archivo').files[0];
    if (!archivo || !usuario || ocupado) return;
    const uid = usuario.id;
    bloquear(true);
    let agregados = 0;
    try {
        if (archivo.size > 100 * 1024 * 1024) throw new Error('El respaldo supera los 100 MB.');
        const contenido = JSON.parse(await archivo.text());
        const filas = Array.isArray(contenido) ? contenido : contenido.version === 2 ? contenido.libros : null;
        if (!Array.isArray(filas) || !filas.every(validarImportado)) throw new Error('El archivo no es un respaldo valido del catalogo.');
        if (cargando) throw new Error('Espera a que termine la actualizacion y vuelve a cargar el respaldo.');
        await cargar(true);
        if (!$('estado').textContent.startsWith('Actualizado')) throw new Error('No se pudo comprobar tu biblioteca. Intenta de nuevo con conexion.');
        if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
        if (!confirm('¿Agregar los libros de este respaldo a tu cuenta? Los registros ya existentes se omitiran.')) return;
        const firma = l => JSON.stringify([l.titulo.trim(), l.autor.trim(), l.movimiento.trim(), l.anio === '' ? null : l.anio, l.comentario.trim()]);
        const existentes = new Set(libros.map(firma));
        for (const l of filas) {
            if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
            if (existentes.has(firma(l))) continue;
            let ruta = null;
            if (l.imagen_base64) {
                const blob = await (await fetch(l.imagen_base64)).blob();
                const preparada = await prepararImagen(blob);
                if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
                ruta = uid + '/' + crypto.randomUUID() + '.jpg';
                const {error} = await cliente.storage.from('portadas').upload(ruta, preparada, {contentType: 'image/jpeg', upsert: false});
                if (error) throw error;
            }
            if (usuario?.id !== uid) throw new Error('La cuenta cambio. Vuelve a iniciar la operacion.');
            const {error} = await cliente.from('libros').insert({usuario_id: uid, titulo: l.titulo.trim(), autor: l.autor.trim(), movimiento: l.movimiento.trim(), anio: l.anio === '' ? null : l.anio, comentario: l.comentario.trim(), imagen_ruta: ruta});
            if (error) throw error;
            agregados++; existentes.add(firma(l));
        }
        mensaje('Respaldo cargado: ' + agregados + ' libros agregados.');
    } catch (error) { mensaje('Importacion detenida. Se agregaron ' + agregados + ' libros antes del problema. ' + errorTexto(error), true); }
    finally { $('archivo').value = ''; bloquear(false); await cargar(); }
}

$('mostrarContrasena').onchange = () => $('contrasena').type = $('mostrarContrasena').checked ? 'text' : 'password';
$('formLogin').onsubmit = async evento => {
    evento.preventDefault();
    if (!cliente) { $('errorLogin').textContent = 'No se pudo cargar la conexion. Revisa internet y recarga la pagina.'; return; }
    $('entrar').disabled = true; $('errorLogin').textContent = 'Iniciando sesion...';
    try {
        const {data, error} = await cliente.auth.signInWithPassword({email: $('correo').value.trim(), password: $('contrasena').value});
        if (error) throw error;
        aplicarSesion(data.session);
    } catch (error) {
        $('errorLogin').textContent = error.code === 'invalid_credentials' ? 'Correo o contraseña incorrectos.' : error.code === 'email_not_confirmed' ? 'El correo de esta cuenta no esta confirmado.' : 'No se pudo iniciar sesion. ' + errorTexto(error);
    } finally { $('entrar').disabled = false; }
};
$('cerrarSesion').onclick = async () => {
    if (ocupado) return;
    bloquear(true);
    try {
        const {error} = await cliente.auth.signOut({scope: 'local'});
        if (error) throw error;
        aplicarSesion(null);
    } catch (error) { mensaje('No se pudo cerrar la sesion. ' + errorTexto(error), true); }
    finally { bloquear(false); }
};
$('formulario').onsubmit = guardar;
$('cancelar').onclick = () => { limpiar(); mensaje(''); };
$('buscar').oninput = renderizar;
$('filtro').onchange = renderizar;
$('orden').onchange = renderizar;
$('actualizar').onclick = () => cargar();
$('exportar').onclick = exportar;
$('importar').onclick = () => $('archivo').click();
$('archivo').onchange = importar;
$('imagen').onchange = async () => {
    const archivo = $('imagen').files[0];
    if (!archivo) return;
    const turno = ++revisionImagen;
    bloquear(true);
    try {
        const blob = await prepararImagen(archivo);
        if (turno !== revisionImagen) return;
        nuevaImagen = blob; quitarPortada = false;
        if (previaLocal) URL.revokeObjectURL(previaLocal);
        previaLocal = URL.createObjectURL(blob); portada($('vistaPrevia'), previaLocal);
        $('quitarImagen').hidden = false;
        mensaje('Portada preparada. Pulsa Guardar para subirla con el libro.');
    } catch (error) { $('imagen').value = ''; mensaje(errorTexto(error), true); }
    finally { bloquear(false); }
};
$('quitarImagen').onclick = () => {
    revisionImagen++; nuevaImagen = null; quitarPortada = true; $('imagen').value = '';
    if (previaLocal) URL.revokeObjectURL(previaLocal);
    previaLocal = null; portada($('vistaPrevia'), null); $('quitarImagen').hidden = true;
};
window.addEventListener('focus', () => cargar());
window.addEventListener('online', () => cargar());
window.addEventListener('offline', () => { $('estado').textContent = 'Sin conexion. Los cambios necesitan internet para guardarse.'; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
setInterval(() => { if (!document.hidden) cargar(); }, 15000);
try {
    if (!window.supabase) throw new Error('Revisa internet y recarga la pagina para cargar la conexion.');
    cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    cliente.auth.onAuthStateChange((evento, sesion) => { setTimeout(() => aplicarSesion(sesion), 0); });
    cliente.auth.getSession().then(({data, error}) => {
        if (error) $('errorLogin').textContent = errorTexto(error);
        else aplicarSesion(data.session);
    }).catch(error => { $('errorLogin').textContent = errorTexto(error); });
} catch (error) { $('errorLogin').textContent = errorTexto(error); }
