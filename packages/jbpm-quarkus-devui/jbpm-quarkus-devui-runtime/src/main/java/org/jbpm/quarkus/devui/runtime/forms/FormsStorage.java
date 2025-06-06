/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
package org.jbpm.quarkus.devui.runtime.forms;

import java.io.IOException;
import java.util.Collection;

import org.jbpm.quarkus.devui.runtime.forms.model.Form;
import org.jbpm.quarkus.devui.runtime.forms.model.FormContent;
import org.jbpm.quarkus.devui.runtime.forms.model.FormFilter;
import org.jbpm.quarkus.devui.runtime.forms.model.FormInfo;

public interface FormsStorage {

    int getFormsCount();

    Collection<FormInfo> getFormInfoList(FormFilter filter);

    Form getFormContent(String formName) throws IOException;

    void updateFormContent(String formName, FormContent formContent) throws IOException;

    void refresh();
}
